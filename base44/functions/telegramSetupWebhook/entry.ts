/**
 * One-time Telegram webhook registration.
 * Admin-only. Registers `telegramWebhook` function URL with Telegram so
 * incoming messages are forwarded here.
 *
 * Usage: call this once from the Signer/admin page, or directly.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!token) return Response.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 400 });

    // Derive webhook URL from current request (same domain)
    const url = new URL(req.url);
    const webhookUrl = `${url.origin}/functions/telegramWebhook`;

    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'edited_message'],
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    return Response.json({
      success: data.ok === true,
      webhookUrl,
      telegramResponse: data,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});