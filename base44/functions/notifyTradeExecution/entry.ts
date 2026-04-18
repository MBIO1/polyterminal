import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { event, data } = await req.json();

    if (!data || !event) {
      return Response.json({ error: 'Missing event or data' }, { status: 400 });
    }

    const trade = data;
    const telegramToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const telegramChatId = Deno.env.get('TELEGRAM_CHAT_ID');

    if (!telegramToken || !telegramChatId) {
      console.log('⚠️ Telegram credentials not set, skipping notification');
      return Response.json({ skipped: true });
    }

    // Build message based on trade event
    const isEntry = event.type === 'create' || (event.type === 'update' && trade.outcome === 'pending');
    const isExit = event.type === 'update' && (trade.outcome === 'win' || trade.outcome === 'loss');

    let message = '';

    if (isEntry && trade.mode === 'live') {
      message = `
🚀 LIVE TRADE EXECUTED
━━━━━━━━━━━━━━━━━━━━
Market: ${trade.market_title}
Asset: ${trade.asset} (${trade.contract_type})
Side: ${trade.side.toUpperCase()}
Entry: $${Number(trade.entry_price).toFixed(4)} × ${Number(trade.shares).toFixed(2)} shares
Size: $${Number(trade.size_usdc).toFixed(2)} USDC
Edge: ${Number(trade.edge_at_entry).toFixed(2)}%
Confidence: ${Number(trade.confidence_at_entry).toFixed(0)}%
Status: ⏳ Pending`;
    } else if (isExit) {
      const pnl = Number(trade.pnl_usdc || 0);
      const emoji = pnl > 0 ? '✅ WIN' : '❌ LOSS';
      const pnlColor = pnl > 0 ? '+' : '';

      message = `
${emoji}
━━━━━━━━━━━━━━━━━━━━
Market: ${trade.market_title}
Entry: $${Number(trade.entry_price).toFixed(4)}
Exit: $${Number(trade.exit_price).toFixed(4)}
P&L: ${pnlColor}$${pnl.toFixed(4)} USDC
Size: $${Number(trade.size_usdc).toFixed(2)}
Mode: ${trade.mode.toUpperCase()}`;
    }

    if (!message) {
      return Response.json({ skipped: true });
    }

    // Send Telegram message
    const res = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error('Telegram error:', error);
      throw new Error(`Telegram send failed: ${res.status}`);
    }

    return Response.json({ success: true, notified: true });
  } catch (error) {
    console.error('Notification error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});