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

    if (event.type !== 'update' || event.entity_name !== 'ArbConfig') {
      return Response.json({ ok: true });
    }

    const config = data;
    if (!config) {
      return Response.json({ ok: true });
    }

    // Only notify if kill switch was activated or deactivated
    if (old_data?.kill_switch_active === config.kill_switch_active) {
      return Response.json({ ok: true });
    }

    if (config.kill_switch_active) {
      const haltUntil = config.halt_until_ts || 0;
      const haltDuration = haltUntil > 0 ? `${Math.ceil((haltUntil - Date.now()) / 60000)} minutes` : 'Indefinite';

      const msg = `
🛑 <b>KILL SWITCH TRIGGERED</b>
━━━━━━━━━━━━━━━━━━━━━━━━
<b>Reason:</b> Manual activation
<b>Bot Status:</b> ⏸ HALTED
<b>Halt Duration:</b> ${haltDuration}
<b>Timestamp:</b> ${new Date().toISOString()}
━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ <b>Trading is suspended until manual reset.</b>
Check the dashboard for more details.
`.trim();

      await sendTelegramMessage(msg);
    } else {
      const msg = `
✅ <b>KILL SWITCH RESET</b>
━━━━━━━━━━━━━━━━━━━━━━━━
<b>Bot Status:</b> 🟢 ACTIVE
<b>Timestamp:</b> ${new Date().toISOString()}
━━━━━━━━━━━━━━━━━━━━━━━━
Trading resumed.
`.trim();

      await sendTelegramMessage(msg);
    }

    return Response.json({ ok: true, notified: true });
  } catch (error) {
    console.error('onArbConfigUpdated error:', error);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});