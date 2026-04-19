/**
 * testTelegramNotification — sends a test message to verify Telegram integration.
 * Admin-only.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const tgToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const tgChat  = Deno.env.get('TELEGRAM_CHAT_ID');

    if (!tgToken || !tgChat) {
      return Response.json({
        success: false,
        error: 'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID',
        hasToken: !!tgToken,
        hasChat: !!tgChat,
      }, { status: 500 });
    }

    const text =
      `🧪 *Test Notification*\n\n` +
      `*Side:* BUY (YES)\n` +
      `*Entry Price:* 0.52\n` +
      `*Size:* $1.00 USDC\n` +
      `*Token:* \`21742633143…\`\n` +
      `*By:* ${user.email}\n` +
      `*Time:* ${new Date().toISOString()}\n\n` +
      `If you see this, your live-trade alerts are working ✅`;

    const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgChat, text, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(5000),
    });

    const responseBody = await res.text();
    console.log(`[TELEGRAM TEST] status=${res.status} body=${responseBody.slice(0, 200)}`);

    if (!res.ok) {
      return Response.json({
        success: false,
        status: res.status,
        telegramResponse: responseBody,
      }, { status: 500 });
    }

    return Response.json({
      success: true,
      message: 'Test notification sent to Telegram',
      telegramResponse: JSON.parse(responseBody),
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});