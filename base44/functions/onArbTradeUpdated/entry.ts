import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Telegram credentials not set, skipping');
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Telegram API error: ${res.status} ${err}`);
  }
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { event, data, old_data } = body;

    if (event.type !== 'update' || event.entity_name !== 'ArbTrade') {
      return Response.json({ ok: true });
    }

    const trade = data;
    if (!trade) {
      return Response.json({ ok: true });
    }

    // Only notify on status changes to Closed
    if (trade.status !== 'Closed' || old_data?.status === 'Closed') {
      return Response.json({ ok: true });
    }

    const mode = trade.mode === 'live' ? 'LIVE' : 'PAPER';
    const outcomeEmoji = trade.net_pnl >= 0 ? '✅' : '❌';
    const pnlEmoji = trade.net_pnl >= 0 ? '📈' : '📉';

    const msg = `
${outcomeEmoji} <b>TRADE RESOLVED</b>
━━━━━━━━━━━━━━━━━━━━━━━━
<b>Trade ID:</b> ${trade.trade_id || '—'}
<b>Asset:</b> ${trade.asset || '—'}
<b>Strategy:</b> ${trade.strategy || '—'}
<b>P&L:</b> ${pnlEmoji} <code>${trade.net_pnl >= 0 ? '+' : ''}$${(trade.net_pnl || 0).toFixed(2)}</code>
<b>P&L %:</b> ${((trade.net_pnl_bps || 0) / 100).toFixed(2)}%
<b>Mode:</b> <code>${mode}</code>
━━━━━━━━━━━━━━━━━━━━━━━━
Entry: ${(trade.spot_entry_px || 0).toFixed(4)} | Exit: ${(trade.spot_exit_px || 0).toFixed(4)}
Hold: ${(trade.hold_hours || 0).toFixed(1)}h
Time: ${new Date().toISOString()}
`.trim();

    await sendTelegramMessage(msg);

    return Response.json({ ok: true, notified: true });
  } catch (error) {
    console.error('onArbTradeUpdated error:', error);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});