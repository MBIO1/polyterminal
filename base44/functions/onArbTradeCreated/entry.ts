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
    const { event, data } = body;

    if (event.type !== 'create' || event.entity_name !== 'ArbTrade') {
      return Response.json({ ok: true });
    }

    const trade = data;
    if (!trade) {
      return Response.json({ ok: true });
    }

    const mode = trade.mode === 'live' ? 'LIVE' : 'PAPER';
    const modeEmoji = trade.mode === 'live' ? '🚀' : '📄';

    const msg = `
${modeEmoji} <b>NEW TRADE EXECUTED</b>
━━━━━━━━━━━━━━━━━━━━━━━━
<b>Trade ID:</b> ${trade.trade_id || '—'}
<b>Asset:</b> ${trade.asset || '—'}
<b>Strategy:</b> ${trade.strategy || '—'}
<b>Direction:</b> ${trade.direction || '—'}
<b>Entry Price:</b> ${trade.spot_entry_px ? trade.spot_entry_px.toFixed(4) : '—'}
<b>Mode:</b> <code>${mode}</code>
<b>Status:</b> ${trade.status || 'Planned'}
━━━━━━━━━━━━━━━━━━━━━━━━
Spot Ex: ${trade.spot_exchange || '—'} | Perp Ex: ${trade.perp_exchange || '—'}
Time: ${new Date().toISOString()}
`.trim();

    await sendTelegramMessage(msg);

    return Response.json({ ok: true, notified: true });
  } catch (error) {
    console.error('onArbTradeCreated error:', error);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});