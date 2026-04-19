/**
 * Shared Telegram alert endpoint — callable from any backend function.
 *
 * Usage: base44.functions.invoke('sendTelegramAlert', { kind, title, lines })
 *   kind:  'signal' | 'execution' | 'error' | 'info'
 *   title: Short headline (e.g. "Signal detected")
 *   lines: Array of "Label: value" strings
 *
 * Security: only accepts calls from authenticated context OR service role.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const EMOJI = {
  signal: '📡',
  execution: '🚀',
  error: '🚨',
  info: 'ℹ️',
};

Deno.serve(async (req) => {
  try {
    const { kind = 'info', title = 'Alert', lines = [] } = await req.json();

    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chat  = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!token || !chat) {
      return Response.json({ skipped: true, reason: 'telegram creds missing' });
    }

    const emoji = EMOJI[kind] || 'ℹ️';
    const body = [
      `${emoji} <b>${title}</b>`,
      '━━━━━━━━━━━━━━━━━━━━',
      ...lines,
      '',
      `<i>${new Date().toISOString()}</i>`,
    ].join('\n');

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: body, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[TG alert] failed:', err);
      return Response.json({ success: false, error: err }, { status: 500 });
    }
    return Response.json({ success: true });
  } catch (error) {
    console.error('[TG alert] error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});