// Ingest qualified arbitrage signals from the external droplet WS bot.
// Rejects signals with net_edge_bps <= 0 (nothing to trade).
// Fuzzy duplicate detection within 30s window.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TELEGRAM_ALERT_MIN_BPS  = 20;
const TELEGRAM_NEAR_MISS_MIN_BPS = 6;
const NEAR_MISS_COOLDOWN_MS   = 15 * 60 * 1000;
const DUPLICATE_WINDOW_MS     = 30_000;
const PRICE_TOLERANCE_PCT     = 0.001; // 0.1%

const lastNearMissByPair = new Map();

async function pushTelegramAlert(signal, kind = 'full') {
  const token  = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return;

  const edge = Number(signal.net_edge_bps || 0);
  const raw  = Number(signal.raw_spread_bps || 0);
  const fill = Math.round(Number(signal.fillable_size_usd || 0));
  const ageMs = Number(signal.signal_age_ms || 0);

  const isNearMiss   = kind === 'near_miss';
  const profitLabel  = edge >= 20 ? '✅ TRADEABLE' : edge >= 10 ? '⚠️ NEAR-MISS' : '📊 MONITORING';
  const header       = isNearMiss
    ? `👀 <b>NEAR-MISS · ${edge.toFixed(1)} bps</b> <i>(below 20 bps floor)</i>\n${profitLabel}`
    : `${edge >= 40 ? '🚨🚨' : edge >= 25 ? '🚨' : '⚡'} <b>ARB SIGNAL · ${edge.toFixed(1)} bps</b>\n${profitLabel}`;

  const feesCost    = 4 * 2;
  const profitExplain = edge >= 20
    ? `💰 Est. profit: ~${(edge - feesCost).toFixed(1)} bps after fees on $${fill.toLocaleString()}`
    : `⚠️ Edge ${edge.toFixed(1)} bps — fees = ${feesCost} bps`;

  const text = [
    header,
    '━━━━━━━━━━━━━━━━━━━━━',
    `<b>Pair:</b> ${signal.pair}`,
    `<b>Route:</b> ${signal.buy_exchange} → ${signal.sell_exchange}`,
    `<b>Buy @ </b><code>${Number(signal.buy_price).toFixed(4)}</code>  <b>Sell @ </b><code>${Number(signal.sell_price).toFixed(4)}</code>`,
    `<b>Raw spread:</b> ${raw.toFixed(2)} bps  |  <b>Net edge:</b> <code>${edge.toFixed(2)} bps</code>`,
    `<b>Fillable:</b> $${fill.toLocaleString()}  |  <b>Age:</b> ${ageMs} ms`,
    profitExplain,
    signal.notes ? `<i>${signal.notes}</i>` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error('Telegram push failed:', res.status, await res.text());
  } catch (e) {
    console.error('Telegram push exception:', e.message);
  }
}

async function checkFuzzyDuplicate(base44, signal) {
  const recent = await base44.asServiceRole.entities.ArbSignal.filter(
    { pair: signal.pair }, '-received_time', 10,
  );

  for (const existing of recent) {
    const ageMs = Date.now() - new Date(existing.received_time || existing.created_date).getTime();
    if (ageMs > DUPLICATE_WINDOW_MS) continue;
    if (existing.buy_exchange !== signal.buy_exchange || existing.sell_exchange !== signal.sell_exchange) continue;

    const buyDiff  = Math.abs((existing.buy_price  - signal.buy_price)  / signal.buy_price);
    const sellDiff = Math.abs((existing.sell_price - signal.sell_price) / signal.sell_price);

    if (buyDiff < PRICE_TOLERANCE_PCT && sellDiff < PRICE_TOLERANCE_PCT) {
      return { isDuplicate: true, existingId: existing.id };
    }
  }
  return { isDuplicate: false };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });

    const base44 = createClientFromRequest(req);
    const user   = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let body;
    try { body = await req.json(); }
    catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    // Required fields
    const required = ['pair', 'buy_exchange', 'sell_exchange', 'raw_spread_bps', 'net_edge_bps'];
    for (const k of required) {
      if (body[k] === undefined || body[k] === null) {
        return Response.json({ error: `Missing field: ${k}` }, { status: 400 });
      }
    }

    // Reject signals with non-positive net edge — nothing to trade
    const netEdge = Number(body.net_edge_bps);
    if (netEdge <= 0) {
      return Response.json({ ok: true, rejected: true, reason: 'net_edge_bps <= 0' });
    }

    // Fuzzy duplicate detection
    const dupCheck = await checkFuzzyDuplicate(base44, body);
    if (dupCheck.isDuplicate) {
      return Response.json({ ok: true, duplicate: true, signal_id: dupCheck.existingId });
    }

    const asset = body.asset || (body.pair || '').split('-')[0] || 'Other';
    const now   = new Date().toISOString();

    const signal = await base44.asServiceRole.entities.ArbSignal.create({
      signal_time:         body.signal_time || now,
      received_time:       now,
      pair:                body.pair,
      asset,
      buy_exchange:        body.buy_exchange,
      sell_exchange:       body.sell_exchange,
      buy_price:           Number(body.buy_price)           || 0,
      sell_price:          Number(body.sell_price)          || 0,
      raw_spread_bps:      Number(body.raw_spread_bps)      || 0,
      net_edge_bps:        netEdge,
      buy_depth_usd:       Number(body.buy_depth_usd)       || 0,
      sell_depth_usd:      Number(body.sell_depth_usd)      || 0,
      fillable_size_usd:   Number(body.fillable_size_usd)   || 0,
      signal_age_ms:       Number(body.signal_age_ms)       || 0,
      exchange_latency_ms: Number(body.exchange_latency_ms) || 0,
      confirmed_exchanges: Number(body.confirmed_exchanges) || 1,
      status:              body.alert ? 'alerted' : 'detected',
      notes:               String(body.notes || '').slice(0, 1000),
    });

    console.log(`[ingestSignal] ${body.pair} net=${netEdge.toFixed(2)}bps fill=$${Math.round(body.fillable_size_usd||0)} → ${signal.id}`);

    // Telegram alerts
    if (netEdge >= TELEGRAM_ALERT_MIN_BPS) {
      await pushTelegramAlert({ ...body, ...signal }, 'full');
    } else if (netEdge >= TELEGRAM_NEAR_MISS_MIN_BPS) {
      const last = lastNearMissByPair.get(body.pair) || 0;
      if (Date.now() - last >= NEAR_MISS_COOLDOWN_MS) {
        lastNearMissByPair.set(body.pair, Date.now());
        await pushTelegramAlert({ ...body, ...signal }, 'near_miss');
      }
    }

    if (body.alert) {
      await base44.asServiceRole.functions.invoke('slackAlert', {
        alert_type:  'funding_anomaly',
        severity:    netEdge >= 25 ? 'High' : 'Medium',
        title:       `${body.pair} ${netEdge.toFixed(1)} bps · ${body.buy_exchange}→${body.sell_exchange}`,
        description: `Buy ${body.buy_exchange} @ ${Number(body.buy_price).toFixed(2)} · Sell ${body.sell_exchange} @ ${Number(body.sell_price).toFixed(2)}. Fillable ~$${Math.round(body.fillable_size_usd||0).toLocaleString()}.`,
      }).catch(e => console.error('slackAlert:', e.message));
    }

    return Response.json({ ok: true, signal_id: signal.id });

  } catch (error) {
    console.error('ingestSignal error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});