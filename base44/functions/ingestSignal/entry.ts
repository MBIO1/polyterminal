// Ingest qualified arbitrage signals from the external droplet WS bot.
// The droplet authenticates as a Base44 user (token in Authorization header),
// so no custom shared secret is needed.
//
// Expected POST body (JSON):
// {
//   pair: "BTC-USDT",
//   asset: "BTC",
//   buy_exchange: "Coinbase",
//   sell_exchange: "Binance",
//   buy_price: 67012.3,
//   sell_price: 67089.1,
//   raw_spread_bps: 11.4,
//   net_edge_bps: 4.2,
//   buy_depth_usd: 125000,
//   sell_depth_usd: 98000,
//   fillable_size_usd: 50000,
//   signal_age_ms: 85,
//   exchange_latency_ms: 42,
//   confirmed_exchanges: 3,
//   signal_time: "2026-04-20T12:34:56.789Z",
//   alert: true   // optional - if true, also fire Slack/Telegram
// }
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Minimum net edge (bps) that triggers a Telegram push. Matches the droplet's trading floor.
const TELEGRAM_ALERT_MIN_BPS = 20;

async function pushTelegramAlert(signal) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return; // silently skip if not configured

  const edge = Number(signal.net_edge_bps || 0);
  const raw = Number(signal.raw_spread_bps || 0);
  const fill = Math.round(Number(signal.fillable_size_usd || 0));
  const ageMs = Number(signal.signal_age_ms || 0);
  const emoji = edge >= 40 ? '🚨🚨' : edge >= 25 ? '🚨' : '⚡';

  const text = [
    `${emoji} <b>ARB SIGNAL · ${edge.toFixed(1)} bps</b>`,
    '━━━━━━━━━━━━━━━━━━━━━',
    `<b>Pair:</b> ${signal.pair}`,
    `<b>Route:</b> ${signal.buy_exchange} → ${signal.sell_exchange}`,
    `<b>Buy:</b> ${Number(signal.buy_price).toFixed(4)}`,
    `<b>Sell:</b> ${Number(signal.sell_price).toFixed(4)}`,
    `<b>Raw spread:</b> ${raw.toFixed(2)} bps`,
    `<b>Net edge:</b> <code>${edge.toFixed(2)} bps</code>`,
    `<b>Fillable:</b> $${fill.toLocaleString()}`,
    `<b>Age:</b> ${ageMs} ms`,
    signal.notes ? `<i>${signal.notes}</i>` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Telegram push failed:', res.status, err);
    }
  } catch (e) {
    console.error('Telegram push exception:', e.message);
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'POST only' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const required = ['pair', 'buy_exchange', 'sell_exchange', 'raw_spread_bps', 'net_edge_bps'];
    for (const k of required) {
      if (body[k] === undefined || body[k] === null) {
        return Response.json({ error: `Missing field: ${k}` }, { status: 400 });
      }
    }

    const asset = body.asset || (body.pair || '').split('-')[0] || 'Other';
    const now = new Date().toISOString();

    // Duplicate guard: same pair+buy+sell within last 30s
    const recent = await base44.asServiceRole.entities.ArbSignal.filter(
      { pair: body.pair, buy_exchange: body.buy_exchange, sell_exchange: body.sell_exchange },
      '-received_time',
      1,
    );
    if (recent[0]) {
      const ageMs = Date.now() - new Date(recent[0].received_time || recent[0].created_date).getTime();
      if (ageMs < 30_000) {
        return Response.json({ ok: true, duplicate: true, signal_id: recent[0].id });
      }
    }

    const signal = await base44.asServiceRole.entities.ArbSignal.create({
      signal_time: body.signal_time || now,
      received_time: now,
      pair: body.pair,
      asset,
      buy_exchange: body.buy_exchange,
      sell_exchange: body.sell_exchange,
      buy_price: Number(body.buy_price) || 0,
      sell_price: Number(body.sell_price) || 0,
      raw_spread_bps: Number(body.raw_spread_bps) || 0,
      net_edge_bps: Number(body.net_edge_bps) || 0,
      buy_depth_usd: Number(body.buy_depth_usd) || 0,
      sell_depth_usd: Number(body.sell_depth_usd) || 0,
      fillable_size_usd: Number(body.fillable_size_usd) || 0,
      signal_age_ms: Number(body.signal_age_ms) || 0,
      exchange_latency_ms: Number(body.exchange_latency_ms) || 0,
      confirmed_exchanges: Number(body.confirmed_exchanges) || 1,
      status: body.alert ? 'alerted' : 'detected',
      notes: body.notes || '',
    });

    // Telegram alert for any signal that crosses the 20 bps trading floor
    if (Number(body.net_edge_bps) >= TELEGRAM_ALERT_MIN_BPS) {
      await pushTelegramAlert({ ...body, ...signal });
    }

    // Optional fan-out alert
    if (body.alert) {
      await base44.asServiceRole.functions.invoke('slackAlert', {
        alert_type: 'funding_anomaly',
        severity: Number(body.net_edge_bps) >= 25 ? 'High' : 'Medium',
        title: `${body.pair} ${Number(body.net_edge_bps).toFixed(1)} bps · ${body.buy_exchange}→${body.sell_exchange}`,
        description: `Buy ${body.buy_exchange} @ ${Number(body.buy_price).toFixed(2)} · Sell ${body.sell_exchange} @ ${Number(body.sell_price).toFixed(2)}. Fillable ~$${Math.round(body.fillable_size_usd || 0).toLocaleString()}.`,
        fields: [
          { title: 'Pair', value: body.pair },
          { title: 'Raw spread', value: `${Number(body.raw_spread_bps).toFixed(2)} bps` },
          { title: 'Net edge', value: `${Number(body.net_edge_bps).toFixed(2)} bps` },
          { title: 'Buy depth', value: `$${Math.round(body.buy_depth_usd || 0).toLocaleString()}` },
          { title: 'Sell depth', value: `$${Math.round(body.sell_depth_usd || 0).toLocaleString()}` },
          { title: 'Signal age', value: `${body.signal_age_ms || 0} ms` },
          { title: 'Confirmed', value: `${body.confirmed_exchanges || 1}/4` },
        ],
      });
    }

    return Response.json({ ok: true, signal_id: signal.id });
  } catch (error) {
    console.error('ingestSignal error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});