// Fires a Critical Slack + Telegram alert whenever an ArbTrade closes with a loss
// exceeding ArbConfig.max_single_trade_loss_pct of total_capital.
//
// Wired as an entity automation on ArbTrade (update events, status=Closed).
// Also creates an ArbException row so the breach is tracked in the exceptions log.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));

    // Only act on ArbTrade update events
    if (body?.event?.entity_name !== 'ArbTrade') {
      return Response.json({ skipped: true, reason: 'not ArbTrade' });
    }
    if (body.event.type !== 'update') {
      return Response.json({ skipped: true, reason: 'not an update' });
    }

    // Resolve trade data (handle payload_too_large)
    let trade = body.data;
    if (!trade && body.event.entity_id) {
      trade = await base44.asServiceRole.entities.ArbTrade.get(body.event.entity_id);
    }
    if (!trade) return Response.json({ skipped: true, reason: 'no trade data' });

    // Only when transitioning into Closed (avoid duplicate alerts on subsequent edits)
    if (trade.status !== 'Closed') {
      return Response.json({ skipped: true, reason: `status=${trade.status}` });
    }
    const wasAlreadyClosed = body.old_data?.status === 'Closed';
    if (wasAlreadyClosed) {
      return Response.json({ skipped: true, reason: 'already closed before this update' });
    }

    const netPnl = Number(trade.net_pnl || 0);
    if (netPnl >= 0) {
      return Response.json({ skipped: true, reason: 'not a loss' });
    }

    // Pull active threshold from ArbConfig
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config = configs?.[0];
    if (!config) return Response.json({ skipped: true, reason: 'no ArbConfig' });

    const totalCapital = Number(config.total_capital || 0);
    const maxLossPct   = Number(config.max_single_trade_loss_pct || 0);
    if (!totalCapital || !maxLossPct) {
      return Response.json({ skipped: true, reason: 'thresholds not configured' });
    }

    const lossUsd     = Math.abs(netPnl);
    const lossCapUsd  = totalCapital * maxLossPct;
    if (lossUsd <= lossCapUsd) {
      return Response.json({ ok: true, breached: false, loss_usd: lossUsd, cap_usd: lossCapUsd });
    }

    // Breach — fire Critical Slack + Telegram alert and log an exception
    const lossPctOfCap = (lossUsd / totalCapital) * 100;
    const title       = `${trade.trade_id || trade.id} · ${trade.asset || ''} lost $${lossUsd.toFixed(2)}`;
    const description = `Single-trade loss of $${lossUsd.toFixed(2)} (${lossPctOfCap.toFixed(2)}% of capital) exceeded the ${(maxLossPct * 100).toFixed(2)}% cap ($${lossCapUsd.toFixed(2)}). Strategy: ${trade.strategy || 'n/a'}. Mode: ${trade.mode || 'n/a'}.`;

    await base44.asServiceRole.functions.invoke('slackAlert', {
      alert_type:  'margin_breach',
      severity:    'Critical',
      title,
      description,
      fields: [
        { title: 'Trade ID',       value: trade.trade_id },
        { title: 'Asset',          value: trade.asset },
        { title: 'Strategy',       value: trade.strategy },
        { title: 'Net P&L (USD)',  value: netPnl.toFixed(2) },
        { title: 'Net P&L (bps)',  value: Number(trade.net_pnl_bps || 0).toFixed(2) },
        { title: 'Loss cap (USD)', value: lossCapUsd.toFixed(2) },
        { title: 'Mode',           value: trade.mode },
        { title: 'Spot venue',     value: trade.spot_exchange },
        { title: 'Perp venue',     value: trade.perp_exchange },
      ],
    }).catch(e => console.error('[singleTradeLossAlert] slackAlert failed:', e.message));

    // Log an ArbException for the exceptions list / audit trail
    const excId = `LOSS-${Date.now()}`;
    await base44.asServiceRole.entities.ArbException.create({
      exception_id:    excId,
      exception_date:  new Date().toISOString(),
      type:            'Execution',
      exchange:        trade.spot_exchange || trade.perp_exchange || '',
      asset:           trade.asset || '',
      linked_trade_id: trade.trade_id || '',
      status:          'Open',
      severity:        'Critical',
      description:     `max_single_trade_loss_pct breach. ${description}`,
    }).catch(e => console.error('[singleTradeLossAlert] exception create failed:', e.message));

    console.log(`[singleTradeLossAlert] BREACH ${trade.trade_id} loss=$${lossUsd.toFixed(2)} cap=$${lossCapUsd.toFixed(2)}`);

    return Response.json({
      ok: true,
      breached: true,
      loss_usd: lossUsd,
      cap_usd: lossCapUsd,
      exception_id: excId,
    });

  } catch (error) {
    console.error('singleTradeLossAlert error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});