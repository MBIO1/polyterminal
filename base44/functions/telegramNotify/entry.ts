/**
 * Telegram Notifications for Trading Bot
 *
 * Sends real-time alerts to Telegram whenever:
 * - A new trade is executed (live or paper)
 * - A trade outcome is resolved (win/loss/cancelled)
 * - Kill switch is triggered
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
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
    throw new Error(`Telegram API error: ${res.status} ${err}`);
  }
  return res.json();
}

function formatTradeMessage(trade, isNew = false) {
  const emoji = {
    paper: '📄',
    live: '🚀',
    win: '✅',
    loss: '❌',
    pending: '⏳',
    cancelled: '🚫',
  };

  const mode = trade.mode === 'live' ? 'LIVE' : 'PAPER';
  const modeEmoji = emoji[trade.mode] || '📊';
  const outcomeEmoji = emoji[trade.outcome] || '❓';

  if (isNew) {
    return `
${modeEmoji} <b>NEW TRADE EXECUTED</b>
━━━━━━━━━━━━━━━━━━━━━━━━
<b>Asset:</b> ${trade.asset}
<b>Contract:</b> ${trade.contract_type?.replace(/_/g, ' ').toUpperCase() || '—'}
<b>Side:</b> <code>${trade.side?.toUpperCase()}</code>
<b>Size:</b> $${(trade.size_usdc || 0).toFixed(2)}
<b>Entry Price:</b> ${(trade.entry_price || 0).toFixed(4)}
<b>Mode:</b> <code>${mode}</code>
<b>Confidence:</b> ${(trade.confidence_at_entry || 0).toFixed(1)}%
<b>Status:</b> ${outcomeEmoji} ${trade.outcome?.toUpperCase() || 'PENDING'}
━━━━━━━━━━━━━━━━━━━━━━━━
Market: ${trade.market_title || '—'}
${trade.notes ? `Notes: <code>${trade.notes.slice(0, 50)}</code>` : ''}
`.trim();
  } else {
    // Trade outcome update
    const pnl = trade.pnl_usdc || 0;
    const pnlColor = pnl >= 0 ? 'green' : 'red';
    const pnlEmoji = pnl >= 0 ? '📈' : '📉';

    return `
${outcomeEmoji} <b>TRADE RESOLVED</b>
━━━━━━━━━━━━━━━━━━━━━━━━
<b>Asset:</b> ${trade.asset}
<b>Contract:</b> ${trade.contract_type?.replace(/_/g, ' ').toUpperCase() || '—'}
<b>Outcome:</b> <b><span class="tg-span">${trade.outcome?.toUpperCase()}</span></b>
<b>P&L:</b> ${pnlEmoji} <code>${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)}</code>
<b>Mode:</b> <code>${mode}</code>
━━━━━━━━━━━━━━━━━━━━━━━━
Entry: ${(trade.entry_price || 0).toFixed(4)} | Exit: ${(trade.exit_price || 0).toFixed(4)}
Size: $${(trade.size_usdc || 0).toFixed(2)}
Executed: ${new Date(trade.created_date).toLocaleString()}
`.trim();
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action, trade, config } = body;

    // ── Trade notifications ────────────────────────────────────────
    if (action === 'trade_created') {
      if (!trade) return Response.json({ error: 'Missing trade data' }, { status: 400 });
      const msg = formatTradeMessage(trade, true);
      await sendTelegramMessage(msg);
      return Response.json({ success: true, action: 'trade_created', sent: true });
    }

    if (action === 'trade_resolved') {
      if (!trade) return Response.json({ error: 'Missing trade data' }, { status: 400 });
      // Only notify on win/loss (not pending/cancelled)
      if (trade.outcome === 'win' || trade.outcome === 'loss') {
        const msg = formatTradeMessage(trade, false);
        await sendTelegramMessage(msg);
      }
      return Response.json({ success: true, action: 'trade_resolved', sent: true });
    }

    // ── Kill switch notification ───────────────────────────────────
    if (action === 'kill_switch_triggered') {
      if (!config) return Response.json({ error: 'Missing config data' }, { status: 400 });

      const haltUntil = config.halt_until_ts || 0;
      const reason = config.kill_switch_active ? 'Manual kill switch activated' : 'Daily loss limit exceeded';
      const haltDuration = haltUntil > 0 ? `${Math.ceil((haltUntil - Date.now()) / 60000)} minutes` : 'Indefinite';

      const msg = `
🛑 <b>KILL SWITCH TRIGGERED</b>
━━━━━━━━━━━━━━━━━━━━━━━━
<b>Reason:</b> ${reason}
<b>Bot Status:</b> ⏸ HALTED
<b>Halt Duration:</b> ${haltDuration}
<b>Timestamp:</b> ${new Date().toISOString()}
━━━━━━━━━━━━━━━━━━━━━━━━
Daily P&L Loss: ${(config.max_daily_loss_pct || 0).toFixed(1)}%
Max Daily Loss Limit: ${(config.max_daily_loss_pct || 0).toFixed(1)}%

⚠️ <b>Trading is suspended until manual reset.</b>
Check the dashboard for more details.
`.trim();

      await sendTelegramMessage(msg);
      return Response.json({ success: true, action: 'kill_switch_triggered', sent: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Telegram notification error:', error);
    return Response.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
});