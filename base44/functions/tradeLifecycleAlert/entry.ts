// Entity automation handler for ArbTrade lifecycle transitions.
// Fires Slack + Telegram alerts when a trade transitions: Planned → Open → Closed
// (plus Cancelled / Error).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID');

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(8000),
  }).catch(e => console.error('[tradeLifecycleAlert] Telegram error:', e.message));
}

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

    // Slack alert
    await base44.functions.invoke('slackAlert', {
      alert_type: 'exception',
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

    // Telegram alert — check toggle
    const alertCfg = (await base44.asServiceRole.entities.AlertThreshold.list('-created_date', 1))[0] || {};
    const tgEnabled = newStatus === 'Error' || newStatus === 'Cancelled'
      ? alertCfg.tg_trade_exceptions !== false
      : alertCfg.tg_trade_lifecycle !== false;

    if (!tgEnabled) {
      return Response.json({ ok: true, transition: transitionLabel, trade_id: trade.trade_id, tg_skipped: true });
    }

    const tgLines = [
      `${meta.emoji} <b>${meta.label}</b>`,
      '━━━━━━━━━━━━━━━━━━━━',
      `<b>Trade:</b> ${trade.trade_id || '—'} · ${trade.asset || '—'}`,
      `<b>Strategy:</b> ${trade.strategy || '—'}`,
      `<b>Transition:</b> ${transitionLabel}`,
      pnlLine ? `<b>P&amp;L:</b> ${pnlLine}` : '',
      trade.exit_reason ? `<b>Exit reason:</b> ${trade.exit_reason}` : '',
      `<b>Mode:</b> ${trade.mode || '—'}`,
      `<i>${new Date().toISOString()}</i>`,
    ].filter(Boolean).join('\n');
    await sendTelegram(tgLines);

    return Response.json({ ok: true, transition: transitionLabel, trade_id: trade.trade_id });
  } catch (error) {
    console.error('tradeLifecycleAlert error', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});