// Droplet WebSocket arbitrage bot.
// Runs on your VPS, NOT on Base44. Posts qualified signals to Base44.
//
// Start: node bot.mjs
// See README.md for systemd setup.

import 'dotenv/config';
import WebSocket from 'ws';

// ───────────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────────
const INGEST_URL = process.env.BASE44_INGEST_URL;
const STATS_URL = process.env.BASE44_STATS_URL;
const TOKEN = process.env.BASE44_USER_TOKEN;
const PAIRS = (process.env.PAIRS || 'BTC-USDT,ETH-USDT,SOL-USDT,AVAX-USDT,LINK-USDT,MATIC-USDT,DOGE-USDT,ADA-USDT').split(',');
const MIN_NET_EDGE_BPS = Number(process.env.MIN_NET_EDGE_BPS || 2);
const MAX_SIGNAL_AGE_MS = Number(process.env.MAX_SIGNAL_AGE_MS || 500);
const MIN_FILLABLE_USD = Number(process.env.MIN_FILLABLE_USD || 2_000);
const ALERT_EDGE_BPS = Number(process.env.ALERT_EDGE_BPS || 10);
const TAKER_FEE_BPS = Number(process.env.TAKER_FEE_BPS || 10);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 60_000);

if (!INGEST_URL || !TOKEN) {
  console.error('Missing BASE44_INGEST_URL or BASE44_USER_TOKEN');
  process.exit(1);
}

// Per-pair adaptive threshold (overrides MIN_NET_EDGE_BPS when higher)
const pairThresholds = Object.fromEntries(PAIRS.map(p => [p, MIN_NET_EDGE_BPS]));

// Book state: books[exchange][pair] = { bid, ask, bidSize, askSize, ts }
const books = { OKX: {}, Binance: {}, Coinbase: {}, Bybit: {}, Kraken: {} };

// Recently-posted signals for local dedupe (key = pair+buy+sell, value = ts)
const recentlyPosted = new Map();

// Diagnostic counters (reset each heartbeat)
const stats = {
  evaluations: 0,
  rejected_same_venue: 0,
  rejected_edge: 0,
  rejected_fillable: 0,
  rejected_stale: 0,
  rejected_dedupe: 0,
  posted: 0,
  best_edge_seen_bps: -Infinity,
  best_edge_pair: '',
  best_edge_route: '',
};
function resetStats() {
  for (const k of Object.keys(stats)) {
    if (typeof stats[k] === 'number') stats[k] = k === 'best_edge_seen_bps' ? -Infinity : 0;
    else stats[k] = '';
  }
}

// ───────────────────────────────────────────────────────────────
// WebSocket subscribers
// ───────────────────────────────────────────────────────────────
function connectOKX() {
  const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
  ws.on('open', () => {
    const args = PAIRS.map(p => ({ channel: 'tickers', instId: p }));
    ws.send(JSON.stringify({ op: 'subscribe', args }));
  });
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.data) {
      for (const d of msg.data) {
        const pair = d.instId;
        books.OKX[pair] = {
          bid: Number(d.bidPx), ask: Number(d.askPx),
          bidSize: Number(d.bidSz) * Number(d.bidPx),
          askSize: Number(d.askSz) * Number(d.askPx),
          ts: Date.now(),
        };
        evaluate(pair);
      }
    }
  });
  ws.on('close', () => setTimeout(connectOKX, 2000));
  ws.on('error', e => console.error('OKX WS:', e.message));
}

let binanceFailCount = 0;
function connectBinance() {
  if (binanceFailCount >= 3) {
    if (binanceFailCount === 3) console.log('Binance WS disabled after 3 failures (likely geo-blocked, HTTP 451). Remove Binance from venues.');
    binanceFailCount++;
    return;
  }
  const streams = PAIRS.map(p => p.replace('-', '').toLowerCase() + '@bookTicker').join('/');
  const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
  ws.on('message', raw => {
    binanceFailCount = 0;
    const msg = JSON.parse(raw);
    const d = msg.data;
    if (!d || !d.s) return;
    const pair = PAIRS.find(p => p.replace('-', '') === d.s);
    if (!pair) return;
    books.Binance[pair] = { bid: Number(d.b), ask: Number(d.a), bidSize: Number(d.B) * Number(d.b), askSize: Number(d.A) * Number(d.a), ts: Date.now() };
    evaluate(pair);
  });
  ws.on('close', () => { binanceFailCount++; setTimeout(connectBinance, Math.min(30000, 2000 * binanceFailCount)); });
  ws.on('error', e => { if (binanceFailCount < 3) console.error('Binance WS:', e.message); });
}

// Kraken — US-friendly replacement/supplement for Binance
function connectKraken() {
  const ws = new WebSocket('wss://ws.kraken.com/v2');
  // Kraken symbol format: BTC/USD, ETH/USD, SOL/USD (no USDT for most majors)
  const krakenMap = { 'BTC-USDT': 'BTC/USD', 'ETH-USDT': 'ETH/USD', 'SOL-USDT': 'SOL/USD', 'AVAX-USDT': 'AVAX/USD', 'LINK-USDT': 'LINK/USD', 'DOGE-USDT': 'DOGE/USD', 'ADA-USDT': 'ADA/USD', 'MATIC-USDT': 'MATIC/USD' };
  const symbols = PAIRS.map(p => krakenMap[p]).filter(Boolean);
  ws.on('open', () => { ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'ticker', symbol: symbols } })); });
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.channel !== 'ticker' || !msg.data) return;
    for (const d of msg.data) {
      const pair = Object.entries(krakenMap).find(([, v]) => v === d.symbol)?.[0];
      if (!pair) continue;
      books.Kraken = books.Kraken || {};
      books.Kraken[pair] = { bid: Number(d.bid), ask: Number(d.ask), bidSize: Number(d.bid_qty) * Number(d.bid), askSize: Number(d.ask_qty) * Number(d.ask), ts: Date.now() };
      evaluate(pair);
    }
  });
  ws.on('close', () => setTimeout(connectKraken, 2000));
  ws.on('error', e => console.error('Kraken WS:', e.message));
}

function connectCoinbase() {
  const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
  ws.on('open', () => {
    // Coinbase uses BTC-USD not BTC-USDT — map accordingly
    const product_ids = PAIRS.map(p => p.replace('-USDT', '-USD'));
    ws.send(JSON.stringify({ type: 'subscribe', product_ids, channels: ['ticker'] }));
  });
  ws.on('message', raw => {
    const d = JSON.parse(raw);
    if (d.type !== 'ticker' || !d.product_id) return;
    const pair = d.product_id.replace('-USD', '-USDT');
    if (!PAIRS.includes(pair)) return;
    books.Coinbase[pair] = {
      bid: Number(d.best_bid), ask: Number(d.best_ask),
      bidSize: Number(d.best_bid_size) * Number(d.best_bid),
      askSize: Number(d.best_ask_size) * Number(d.best_ask),
      ts: Date.now(),
    };
    evaluate(pair);
  });
  ws.on('close', () => setTimeout(connectCoinbase, 2000));
  ws.on('error', e => console.error('Coinbase WS:', e.message));
}

function connectBybit() {
  const ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');
  ws.on('open', () => {
    const args = PAIRS.map(p => `tickers.${p.replace('-', '')}`);
    ws.send(JSON.stringify({ op: 'subscribe', args }));
  });
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.topic && msg.data) {
      const sym = msg.topic.split('.')[1];
      const pair = PAIRS.find(p => p.replace('-', '') === sym);
      if (!pair) return;
      const d = msg.data;
      books.Bybit[pair] = {
        bid: Number(d.bid1Price), ask: Number(d.ask1Price),
        bidSize: Number(d.bid1Size) * Number(d.bid1Price),
        askSize: Number(d.ask1Size) * Number(d.ask1Price),
        ts: Date.now(),
      };
      evaluate(pair);
    }
  });
  ws.on('close', () => setTimeout(connectBybit, 2000));
  ws.on('error', e => console.error('Bybit WS:', e.message));
}

// ───────────────────────────────────────────────────────────────
// Signal evaluation
// ───────────────────────────────────────────────────────────────
function evaluate(pair) {
  const now = Date.now();
  stats.evaluations++;
  const venues = ['OKX', 'Binance', 'Coinbase', 'Bybit', 'Kraken'];
  const fresh = venues
    .map(v => ({ v, b: books[v] && books[v][pair] }))
    .filter(x => x.b && now - x.b.ts < MAX_SIGNAL_AGE_MS);

  if (fresh.length < 2) return;

  // Find best bid (sell side) and best ask (buy side) across venues
  let bestAsk = { price: Infinity };
  let bestBid = { price: -Infinity };
  for (const { v, b } of fresh) {
    if (b.ask < bestAsk.price) bestAsk = { v, price: b.ask, size: b.askSize, ts: b.ts };
    if (b.bid > bestBid.price) bestBid = { v, price: b.bid, size: b.bidSize, ts: b.ts };
  }
  if (bestAsk.v === bestBid.v) { stats.rejected_same_venue++; return; }

  const rawSpreadBps = ((bestBid.price - bestAsk.price) / bestAsk.price) * 10_000;
  const netEdgeBps = rawSpreadBps - 2 * TAKER_FEE_BPS;

  // Track best edge seen regardless of thresholds (for diagnostics)
  if (netEdgeBps > stats.best_edge_seen_bps) {
    stats.best_edge_seen_bps = netEdgeBps;
    stats.best_edge_pair = pair;
    stats.best_edge_route = `${bestAsk.v}→${bestBid.v}`;
  }

  const threshold = pairThresholds[pair] || MIN_NET_EDGE_BPS;
  if (netEdgeBps < threshold) { stats.rejected_edge++; return; }

  const fillable = Math.min(bestAsk.size, bestBid.size);
  if (fillable < MIN_FILLABLE_USD) { stats.rejected_fillable++; return; }

  const signalAgeMs = now - Math.min(bestAsk.ts, bestBid.ts);
  if (signalAgeMs > MAX_SIGNAL_AGE_MS) { stats.rejected_stale++; return; }

  // Local dedupe: 20s per (pair, buy, sell)
  const key = `${pair}|${bestAsk.v}|${bestBid.v}`;
  const last = recentlyPosted.get(key);
  if (last && now - last < 20_000) { stats.rejected_dedupe++; return; }
  recentlyPosted.set(key, now);
  stats.posted++;

  post({
    pair,
    asset: pair.split('-')[0],
    buy_exchange: bestAsk.v,
    sell_exchange: bestBid.v,
    buy_price: bestAsk.price,
    sell_price: bestBid.price,
    raw_spread_bps: rawSpreadBps,
    net_edge_bps: netEdgeBps,
    buy_depth_usd: bestAsk.size,
    sell_depth_usd: bestBid.size,
    fillable_size_usd: fillable,
    signal_age_ms: signalAgeMs,
    exchange_latency_ms: 0,
    confirmed_exchanges: fresh.length,
    signal_time: new Date().toISOString(),
    alert: netEdgeBps >= ALERT_EDGE_BPS,
  });
}

async function post(payload) {
  try {
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    console.log(`[${payload.pair}] ${payload.buy_exchange}→${payload.sell_exchange} ${payload.net_edge_bps.toFixed(2)}bps fillable=$${Math.round(payload.fillable_size_usd)} → ${res.status} ${body.duplicate ? '(dup)' : body.signal_id || ''}`);
  } catch (e) {
    console.error('POST failed:', e.message);
  }
}

// ───────────────────────────────────────────────────────────────
// Adaptive thresholds feedback loop
// ───────────────────────────────────────────────────────────────
async function refreshThresholds() {
  if (!STATS_URL) return;
  try {
    const res = await fetch(STATS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
      body: JSON.stringify({ window_hours: 24 }),
    });
    const data = await res.json();
    if (!data?.pairs) return;
    for (const s of data.pairs) {
      if (s.recommended_min_bps && PAIRS.includes(s.pair)) {
        const old = pairThresholds[s.pair];
        pairThresholds[s.pair] = s.recommended_min_bps;
        if (old !== s.recommended_min_bps) {
          console.log(`[threshold] ${s.pair}: ${old} → ${s.recommended_min_bps} bps (win rate ${(s.win_rate * 100).toFixed(1)}%)`);
        }
      }
    }
  } catch (e) {
    console.error('refreshThresholds:', e.message);
  }
}

// Periodic dedupe cleanup
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [k, v] of recentlyPosted) if (v < cutoff) recentlyPosted.delete(k);
}, 30_000);

setInterval(refreshThresholds, 15 * 60_000);

// ───────────────────────────────────────────────────────────────
// Heartbeat — logs connection status + scan stats every minute
// ───────────────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  const conns = Object.entries(books).map(([v, pairs]) => {
    const freshCount = Object.values(pairs).filter(b => now - b.ts < MAX_SIGNAL_AGE_MS * 5).length;
    return `${v}:${freshCount}/${PAIRS.length}`;
  }).join(' ');
  const best = stats.best_edge_seen_bps > -Infinity
    ? `best=${stats.best_edge_seen_bps.toFixed(2)}bps ${stats.best_edge_pair} ${stats.best_edge_route}`
    : 'best=none';
  console.log(
    `[heartbeat] evals=${stats.evaluations} posted=${stats.posted} ` +
    `rej(edge=${stats.rejected_edge} fill=${stats.rejected_fillable} stale=${stats.rejected_stale} dup=${stats.rejected_dedupe} same=${stats.rejected_same_venue}) ` +
    `${best} | ${conns}`
  );
  resetStats();
}, HEARTBEAT_MS);

// ───────────────────────────────────────────────────────────────
// Boot
// ───────────────────────────────────────────────────────────────
console.log(`Arb WS bot starting · pairs: ${PAIRS.join(', ')} · min edge: ${MIN_NET_EDGE_BPS}bps · min fillable: $${MIN_FILLABLE_USD} · max age: ${MAX_SIGNAL_AGE_MS}ms`);
connectOKX();
connectBinance();
connectCoinbase();
connectBybit();
connectKraken();
refreshThresholds();