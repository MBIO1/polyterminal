/**
 * Telegram Webhook Handler — Two-way bot commands
 *
 * Receives messages from Telegram and responds to slash commands:
 *  /status   — current P&L, portfolio, open trades, bot state
 *  /pause    — halt the bot (sets bot_running=false)
 *  /resume   — restart the bot (sets bot_running=true, clears halt)
 *  /stats    — win rate, total trades, last 10 outcomes
 *  /help     — list available commands
 *
 * SECURITY: Only responds to messages from TELEGRAM_CHAT_ID (your chat).
 * All other chat IDs are silently ignored.
 *
 * SETUP: Register this URL with Telegram:
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<this-function-url>
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const AUTHORIZED_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

async function sendReply(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(8000),
  }).catch(err => console.error('[TG] send failed:', err.message));
}

async function handleStatus(base44, chatId) {
  const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
  const config = configs[0] || {};
  const trades = await base44.asServiceRole.entities.ArbTrade.list('-created_date', 500);

  const totalCap = Number(config.total_capital || 0);
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayTrades = trades.filter(t => t.trade_date === todayStr);
  const todayPnl = todayTrades.reduce((s, t) => s + Number(t.net_pnl || 0), 0);
  const totalPnl = trades.reduce((s, t) => s + Number(t.net_pnl || 0), 0);
  
  const wins = trades.filter(t => Number(t.net_pnl || 0) > 0).length;
  const losses = trades.filter(t => Number(t.net_pnl || 0) < 0).length;
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

  const haltUntil = config.halt_until_ts || 0;
  const isHalted = config.kill_switch_active || haltUntil > Date.now();
  const stateEmoji = isHalted ? '⛔' : config.bot_running ? '▶️' : '⏸';
  const stateLabel = isHalted ? 'HALTED' : config.bot_running ? 'RUNNING' : 'PAUSED';
  const modeLabel = config.paper_trading !== false ? '📄 PAPER' : '💰 LIVE';

  const msg = `
${stateEmoji} <b>Bot Status: ${stateLabel}</b>
━━━━━━━━━━━━━━━━━━━━━━━━
<b>Mode:</b> ${modeLabel}
<b>Total Capital:</b> $${totalCap.toLocaleString()}
<b>Total P&L:</b> ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}
<b>Today's P&L:</b> ${todayPnl >= 0 ? '+' : ''}$${todayPnl.toFixed(2)}
<b>Win Rate:</b> ${winRate}% (${wins}W / ${losses}L)
<b>Total Trades:</b> ${trades.length}
${isHalted && haltUntil > Date.now() ? `<b>Halted Until:</b> ${new Date(haltUntil).toLocaleString()}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━
Use /pause, /resume, /stats, /help
`.trim();

  await sendReply(chatId, msg);
}

async function handlePause(base44, chatId) {
  const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
  if (!configs[0]) return sendReply(chatId, '❌ ArbConfig not found');
  await base44.asServiceRole.entities.ArbConfig.update(configs[0].id, { bot_running: false });
  await sendReply(chatId, '⏸ <b>Bot paused</b>\nNo new trades will be executed. Use /resume to restart.');
}

async function handleResume(base44, chatId) {
  const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
  if (!configs[0]) return sendReply(chatId, '❌ ArbConfig not found');
  await base44.asServiceRole.entities.ArbConfig.update(configs[0].id, {
    bot_running: true,
    kill_switch_active: false,
    halt_until_ts: 0,
  });
  await sendReply(chatId, '▶️ <b>Bot resumed</b>\nScanning markets every 5 min. Use /status to check in.');
}

async function handleStats(base44, chatId) {
  const trades = await base44.asServiceRole.entities.ArbTrade.list('-created_date', 50);
  const last10 = trades.slice(0, 10);
  const wins = trades.filter(t => Number(t.net_pnl || 0) > 0).length;
  const losses = trades.filter(t => Number(t.net_pnl || 0) < 0).length;
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

  const btcTrades = trades.filter(t => t.asset === 'BTC');
  const ethTrades = trades.filter(t => t.asset === 'ETH');
  const btcPnl = btcTrades.reduce((s, t) => s + Number(t.net_pnl || 0), 0);
  const ethPnl = ethTrades.reduce((s, t) => s + Number(t.net_pnl || 0), 0);

  const streakLine = last10.map(t =>
    Number(t.net_pnl || 0) > 0 ? '🟢' : Number(t.net_pnl || 0) < 0 ? '🔴' : '⚪'
  ).join('');

  const msg = `
📊 <b>Trading Stats</b>
━━━━━━━━━━━━━━━━━━━━━━━━
<b>Win Rate:</b> ${winRate}%
<b>Total:</b> ${wins}W / ${losses}L (${trades.length} trades)

<b>By Asset:</b>
• BTC: ${btcTrades.length} trades · ${btcPnl >= 0 ? '+' : ''}$${btcPnl.toFixed(2)}
• ETH: ${ethTrades.length} trades · ${ethPnl >= 0 ? '+' : ''}$${ethPnl.toFixed(2)}

<b>Last 10:</b>
${streakLine}
━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

  await sendReply(chatId, msg);
}

async function handleHelp(chatId) {
  const msg = `
🤖 <b>Arb Bot Commands</b>
━━━━━━━━━━━━━━━━━━━━━━━━
/status   — Portfolio, P&L, bot state
/pause    — Halt trading
/resume   — Resume trading
/stats    — Win rate, last 10 trades
/help     — This menu
━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
  await sendReply(chatId, msg);
}

Deno.serve(async (req) => {
  try {
    // Telegram sends POSTs — reject everything else
    if (req.method !== 'POST') {
      return Response.json({ ok: true, msg: 'Telegram webhook endpoint' });
    }

    const update = await req.json();
    const message = update.message || update.edited_message;
    if (!message || !message.text) return Response.json({ ok: true });

    const chatId = String(message.chat.id);
    const text = message.text.trim();

    // Security: only respond to the authorized chat
    if (!AUTHORIZED_CHAT_ID || chatId !== String(AUTHORIZED_CHAT_ID)) {
      console.log(`[TG] Ignored message from unauthorized chat: ${chatId}`);
      return Response.json({ ok: true });
    }

    // Service role base44 (no user auth needed — we verified via chat ID)
    const base44 = createClientFromRequest(req);

    // Parse command (strip any @botname suffix)
    const cmd = text.split(/[\s@]/)[0].toLowerCase();

    switch (cmd) {
      case '/status':  await handleStatus(base44, chatId); break;
      case '/pause':   await handlePause(base44, chatId); break;
      case '/resume':  await handleResume(base44, chatId); break;
      case '/stats':   await handleStats(base44, chatId); break;
      case '/help':
      case '/start':   await handleHelp(chatId); break;
      default:
        if (cmd.startsWith('/')) {
          await sendReply(chatId, `❓ Unknown command: <code>${cmd}</code>\nUse /help for available commands.`);
        }
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error('[TG webhook] Error:', error.message);
    return Response.json({ ok: true }); // always 200 to Telegram
  }
});