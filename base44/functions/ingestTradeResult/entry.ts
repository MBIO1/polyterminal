// ingestTradeResult — called by the droplet order-server after executing a trade on Bybit.
// Updates the ArbTrade record with live order IDs and execution status.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });

  try {
    // Auth: accept droplet secret, bot secret, or valid user session
    const authHeader    = req.headers.get('authorization') || '';
    const token         = authHeader.replace('Bearer ', '').trim();
    const dropletSecret = Deno.env.get('DROPLET_SECRET') || '';
    const botSecret     = Deno.env.get('BOT_SECRET') || '';
    const userToken     = Deno.env.get('BASE44_USER_TOKEN') || '';
    const isDroplet     = !!token && (token === dropletSecret || token === botSecret || token === userToken);

    let authed = isDroplet;
    if (!authed) {
      try {
        const tmpBase44 = createClientFromRequest(req);
        const user = await tmpBase44.auth.me();
        authed = !!user;
      } catch {}
    }
    if (!authed) return Response.json({ error: 'unauthorized' }, { status: 401 });

    // Read body before swapping request
    const body = await req.json().catch(() => null);
    if (!body) return Response.json({ error: 'invalid_json' }, { status: 400 });

    // If droplet call, strip the invalid secret from Authorization header.
    // asServiceRole works on its own inside Base44-hosted functions without user auth.
    let initReq = req;
    if (isDroplet) {
      const headers = new Headers(req.headers);
      headers.delete('Authorization');
      headers.delete('authorization');
      headers.delete('x-base44-auth');
      initReq = new Request(req.url, { method: req.method, headers });
    }
    const base44 = createClientFromRequest(initReq);

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