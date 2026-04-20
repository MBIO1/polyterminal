// Entity automation handler for ArbTrade lifecycle transitions.
// Fires a Slack alert when a trade transitions: Planned → Open → Closed
// (plus Cancelled / Error). Uses existing slackAlert dispatcher.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STAGE_META = {
  Planned:   { emoji: '📝', label: 'Trade Planned',   severity: 'Low' },
  Open:      { emoji: '🟢', label: 'Trade Opened',    severity: 'Medium' },
  Closed:    { emoji: '✅', label: 'Trade Closed',    severity: 'Low' },
  Cancelled: { emoji: '⚪', label: 'Trade Cancelled', severity: 'Low' },
  Error:     { emoji: '❌', label: 'Trade Error',     severity: 'High' },
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const event = body?.event || {};
    if (event.entity_name !== 'ArbTrade') {
      return Response.json({ skipped: true, reason: 'not an ArbTrade event' });
    }

    let trade = body.data;
    if (!trade && event.entity_id) {
      trade = await base44.asServiceRole.entities.ArbTrade.get(event.entity_id);
    }
    if (!trade) return Response.json({ error: 'no trade data' }, { status: 400 });

    const oldStatus = body?.old_data?.status;
    const newStatus = trade.status;

    // Only alert on real transitions (skip if status didn't change on update events)
    if (event.type === 'update' && oldStatus === newStatus) {
      return Response.json({ skipped: true, reason: 'status unchanged' });
    }

    const meta = STAGE_META[newStatus];
    if (!meta) return Response.json({ skipped: true, reason: `unknown status ${newStatus}` });

    const transitionLabel = oldStatus ? `${oldStatus} → ${newStatus}` : newStatus;
    const pnlLine = newStatus === 'Closed'
      ? `Net PnL: ${trade.net_pnl != null ? '$' + Number(trade.net_pnl).toFixed(2) : '—'} (${trade.net_pnl_bps ?? '—'} bps)`
      : '';

    await base44.functions.invoke('slackAlert', {
      alert_type: 'exception', // reuse formatter
      severity: meta.severity,
      title: `${meta.emoji} ${meta.label} · ${trade.trade_id || ''}`,
      description: [
        `Lifecycle: ${transitionLabel}`,
        pnlLine,
        trade.exit_reason ? `Exit reason: ${trade.exit_reason}` : '',
      ].filter(Boolean).join('\n'),
      fields: [
        { title: 'Trade', value: trade.trade_id },
        { title: 'Strategy', value: trade.strategy },
        { title: 'Asset', value: trade.asset },
        { title: 'Direction', value: trade.direction },
        { title: 'Spot venue', value: trade.spot_exchange },
        { title: 'Perp venue', value: trade.perp_exchange },
        { title: 'Entry bps', value: trade.entry_spread_bps },
        { title: 'Exit bps', value: trade.exit_spread_bps },
        { title: 'Mode', value: trade.mode },
      ],
    });

    return Response.json({ ok: true, transition: transitionLabel, trade_id: trade.trade_id });
  } catch (error) {
    console.error('tradeLifecycleAlert error', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});