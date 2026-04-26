// ingestTradeResult — called by the droplet order-server after executing a trade on Bybit.
// Updates the ArbTrade record with live order IDs and execution status.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });

  try {
    const base44 = createClientFromRequest(req);

    // Auth: accept droplet secret OR valid user session
    const authHeader = req.headers.get('authorization') || '';
    const token      = authHeader.replace('Bearer ', '').trim();
    const dropletSecret = Deno.env.get('DROPLET_SECRET');

    let authed = false;
    if (dropletSecret && token === dropletSecret) {
      authed = true; // droplet calling back
    } else {
      try {
        const user = await base44.auth.me();
        authed = !!user;
      } catch {}
    }
    if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    if (!body) return Response.json({ error: 'invalid_json' }, { status: 400 });

    const { trade_id, signal_id, ok, mode, spotOk, perpOk, spotOrderId, perpOrderId, error: execError } = body;

    // Update trade record if trade_id provided
    if (trade_id) {
      const trades = await base44.asServiceRole.entities.ArbTrade.filter({ trade_id }, '-created_date', 1);
      const trade  = trades?.[0];
      if (trade) {
        const notes = ok
          ? `live execution: spotOrderId=${spotOrderId} perpOrderId=${perpOrderId} spotOk=${spotOk} perpOk=${perpOk} mode=${mode}`
          : `execution_failed: ${execError}`;

        await base44.asServiceRole.entities.ArbTrade.update(trade.id, {
          mode:         ok ? 'live' : trade.mode,
          review_notes: notes,
          status:       ok ? 'Closed' : 'Error',
        });
        console.log(`[ingestTradeResult] updated trade ${trade_id} ok=${ok}`);
      }
    }

    // Update signal record if signal_id provided
    if (signal_id) {
      const signals = await base44.asServiceRole.entities.ArbSignal.filter({ id: signal_id }, '-created_date', 1);
      const signal  = signals?.[0];
      if (signal) {
        await base44.asServiceRole.entities.ArbSignal.update(signal.id, {
          status: ok ? 'executed' : 'rejected',
          rejection_reason: ok ? undefined : `droplet_exec_failed: ${execError}`,
          notes: ok
            ? `${signal.notes || ''} | droplet: spotOrderId=${spotOrderId} perpOrderId=${perpOrderId}`.trim()
            : signal.notes,
        });
      }
    }

    return Response.json({ ok: true, received: true });
  } catch (error) {
    console.error('[ingestTradeResult] error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});