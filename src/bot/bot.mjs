/**
 * MBIO Arb WS Bot — Production
 * 
 * Monitors OKX spot vs OKX perp orderbooks via WebSocket for BTC, ETH, SOL.
 * Posts qualified signals to Base44 ingestSignal endpoint.
 * Sends minute-level heartbeats to Base44 ingestHeartbeat endpoint.
 *
 * Required .env variables:
 *   BASE44_INGEST_URL      — full URL to /functions/ingestSignal
 *   BASE44_HEARTBEAT_URL   — full URL to /functions/ingestHeartbeat
 *   BOT_SECRET             — shared secret (Authorization: Bearer <BOT_SECRET>)
 *   OKX_API_KEY            — OKX API key (optional for public books)
 *   OKX_API_SECRET         — OKX API secret (optional)
 *   OKX_PASSPHRASE         — OKX passphrase (optional)
 *   MIN_EDGE_BPS           — minimum net edge to fire a signal (default: 3)
 *   TAKER_FEE_BPS_PER_LEG  — assumed taker fee per leg in bps (default: 2)
 *
 * Run: node bot.mjs
 */

import { WebSocket } from 'ws';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────
const INGEST_URL        = process.env.BASE44_INGEST_URL;
const HEARTBEAT_URL     = process.env.BASE44_HEARTBEAT_URL;
const SECRET            = process.env.BOT_SECRET;
const MIN_EDGE_BPS      = Number(process.env.MIN_EDGE_BPS) || 3;
const TAKER_FEE_PER_LEG = Number(process.env.TAKER_FEE_BPS_PER_LEG) || 2; // bps
const TOTAL_FEE_BPS     = TAKER_FEE_PER_LEG * 2; // 2 legs
const DEDUPE_MS         = 10_000;
const MAX_SIGNAL_AGE_MS = 500;   // reject stale signals
const MIN_FILLABLE_USD  = 500;
const PAIRS = [
  { symbol: 'BTC-USDT', asset: 'BTC' },
  { symbol: 'ETH-USDT', asset: 'ETH' },
  { symbol: 'SOL-USDT', asset: 'SOL' },
];

// OKX WebSocket URLs
const OKX_SPOT_WS  = 'wss://ws.okx.com:8443/ws/v5/public';
const OKX_PERP_WS  = 'wss://ws.okx.com:8443/ws/v5/public';

// ─── State ────────────────────────────────────────────────────────────────────
const spotBooks  = {};   // pair → { bids: [[px, qty]], asks: [[px, qty]], ts }
const perpBooks  = {};   // pair → { bids: [[px, qty]], asks: [[px, qty]], ts }
const lastSignal = {};   // pair → { ts, buyPx, sellPx }

// Heartbeat counters (reset each minute)
let hb = resetCounters();

function resetCounters() {
  return {
    evaluations:        0,
    posted:             0,
    rejected_edge:      0,
    rejected_fillable:  0,
    rejected_stale:     0,
    rejected_dedupe:    0,
    best_edge_bps:      0,
    best_edge_pair:     '',
    best_edge_route:    '',
    // buckets
    bucket_0_5:   0,
    bucket_5_10:  0,
    bucket_10_15: 0,
    bucket_15_20: 0,
    bucket_20_plus: 0,
    // gates
    venue_pair_checks:    0,
    venue_no_book:        0,
    venue_stale_book:     0,
    passed_edge_gate:     0,
    passed_fillable_gate: 0,
    passed_stale_gate:    0,
    passed_dedupe_gate:   0,
    post_attempts:        0,
    post_errors:          0,
    post_non_2xx:         0,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getTopLevel(book, side) {
  const levels = book?.[side];
  if (!levels || levels.length === 0) return null;
  return { px: parseFloat(levels[0][0]), qty: parseFloat(levels[0][1]) };
}

/** Calculate depth-weighted fillable USD up to depthLevels */
function calcFillableUsd(levels, maxLevels = 5) {
  let usd = 0;
  for (let i = 0; i < Math.min(levels.length, maxLevels); i++) {
    const px = parseFloat(levels[i][0]);
    const qty = parseFloat(levels[i][1]);
    usd += px * qty;
  }
  return usd;
}

function bucketEdge(edge) {
  if (edge < 5)  hb.bucket_0_5++;
  else if (edge < 10) hb.bucket_5_10++;
  else if (edge < 15) hb.bucket_10_15++;
  else if (edge < 20) hb.bucket_15_20++;
  else hb.bucket_20_plus++;
}

// ─── Signal evaluation ────────────────────────────────────────────────────────
function evaluate(pair, asset) {
  hb.venue_pair_checks++;

  const spot = spotBooks[pair];
  const perp = perpBooks[pair];

  if (!spot || !perp) { hb.venue_no_book++; return; }

  const now = Date.now();
  const spotAge = now - (spot.ts || 0);
  const perpAge = now - (perp.ts || 0);
  if (spotAge > 2000 || perpAge > 2000) { hb.venue_stale_book++; return; }

  hb.evaluations++;

  // Best arb: buy spot (ask side), sell perp (bid side)
  const spotAsk = getTopLevel(spot, 'asks');
  const perpBid = getTopLevel(perp, 'bids');
  if (!spotAsk || !perpBid) return;

  const rawSpread   = perpBid.px - spotAsk.px;
  const rawSpreadBps = (rawSpread / spotAsk.px) * 10000;
  const netEdgeBps   = rawSpreadBps - TOTAL_FEE_BPS;

  bucketEdge(Math.max(0, netEdgeBps));

  if (netEdgeBps > hb.best_edge_bps) {
    hb.best_edge_bps   = netEdgeBps;
    hb.best_edge_pair  = pair;
    hb.best_edge_route = `OKX-spot→OKX-perp`;
  }

  if (netEdgeBps < MIN_EDGE_BPS) { hb.rejected_edge++; return; }
  hb.passed_edge_gate++;

  // Fillable liquidity check
  const buyDepth  = calcFillableUsd(spot.asks);
  const sellDepth = calcFillableUsd(perp.bids);
  const fillable  = Math.min(buyDepth, sellDepth);
  if (fillable < MIN_FILLABLE_USD) { hb.rejected_fillable++; return; }
  hb.passed_fillable_gate++;

  // Signal age check (time since book update)
  const signalAgeMs = Math.max(spotAge, perpAge);
  if (signalAgeMs > MAX_SIGNAL_AGE_MS) { hb.rejected_stale++; return; }
  hb.passed_stale_gate++;

  // Dedupe check
  const prev = lastSignal[pair];
  if (prev) {
    const timeDiff = now - prev.ts;
    const buyDiff  = Math.abs((spotAsk.px - prev.buyPx) / prev.buyPx);
    const sellDiff = Math.abs((perpBid.px - prev.sellPx) / prev.sellPx);
    if (timeDiff < DEDUPE_MS && buyDiff < 0.0015 && sellDiff < 0.0015) {
      hb.rejected_dedupe++;
      return;
    }
  }
  hb.passed_dedupe_gate++;

  // Fire signal
  lastSignal[pair] = { ts: now, buyPx: spotAsk.px, sellPx: perpBid.px };
  hb.posted++;
  hb.post_attempts++;

  const payload = {
    signal_time:         new Date(now).toISOString(),
    pair,
    asset,
    buy_exchange:        'OKX-spot',
    sell_exchange:       'OKX-perp',
    buy_price:           spotAsk.px,
    sell_price:          perpBid.px,
    raw_spread_bps:      rawSpreadBps,
    net_edge_bps:        netEdgeBps,
    buy_depth_usd:       buyDepth,
    sell_depth_usd:      sellDepth,
    fillable_size_usd:   fillable,
    signal_age_ms:       signalAgeMs,
    exchange_latency_ms: Math.max(spotAge, perpAge),
    confirmed_exchanges: 1,
  };

  axios.post(INGEST_URL, payload, {
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    timeout: 8000,
  }).then(res => {
    if (res.status < 200 || res.status >= 300) hb.post_non_2xx++;
    else console.log(`✅ Signal posted: ${pair} net=${netEdgeBps.toFixed(2)}bps fill=$${Math.round(fillable)}`);
  }).catch(e => {
    hb.post_errors++;
    console.error(`❌ Signal post failed: ${e.message}`);
  });
}

// ─── OKX WebSocket ────────────────────────────────────────────────────────────
function buildOkxWs(url, subscriptions, bookStore, label) {
  let ws;
  let pingInterval;
  let reconnectTimer;

  function connect() {
    console.log(`[${label}] Connecting…`);
    ws = new WebSocket(url);

    ws.on('open', () => {
      console.log(`[${label}] Connected`);
      ws.send(JSON.stringify({ op: 'subscribe', args: subscriptions }));
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 20000);
    });

    ws.on('message', (raw) => {
      const msg = raw.toString();
      if (msg === 'pong') return;
      let data;
      try { data = JSON.parse(msg); } catch { return; }
      if (!data.data || !data.arg) return;

      const instId = data.arg.instId;
      // Map OKX instId (e.g. BTC-USDT or BTC-USDT-SWAP) → our pair key (BTC-USDT)
      const pairKey = instId.replace('-SWAP', '');

      const book = data.data[0];
      if (!book) return;

      // OKX sends full snapshot on 'snapshot', incremental on 'update'
      // For orderbook.1 we always get a full top-of-book replacement
      bookStore[pairKey] = {
        bids: book.bids || [],
        asks: book.asks || [],
        ts:   Date.now(),
      };

      // Evaluate on every book update
      const meta = PAIRS.find(p => p.symbol === pairKey);
      if (meta) evaluate(pairKey, meta.asset);
    });

    ws.on('close', () => {
      console.warn(`[${label}] Disconnected — reconnecting in 3s`);
      clearInterval(pingInterval);
      reconnectTimer = setTimeout(connect, 3000);
    });

    ws.on('error', (e) => {
      console.error(`[${label}] WS error: ${e.message}`);
      ws.close();
    });
  }

  connect();
  return { close: () => { clearTimeout(reconnectTimer); ws?.close(); } };
}

// ─── Connect WebSockets ───────────────────────────────────────────────────────
const spotSubs = PAIRS.map(p => ({ channel: 'books', instId: p.symbol }));
const perpSubs = PAIRS.map(p => ({ channel: 'books', instId: `${p.symbol}-SWAP` }));

buildOkxWs(OKX_SPOT_WS, spotSubs, spotBooks, 'OKX-SPOT');
buildOkxWs(OKX_PERP_WS, perpSubs, perpBooks, 'OKX-PERP');

// ─── Heartbeat (every 60s) ────────────────────────────────────────────────────
setInterval(() => {
  const snap = { ...hb };
  hb = resetCounters();

  const freshParts = PAIRS.map(p => {
    const s = spotBooks[p.symbol];
    const pr = perpBooks[p.symbol];
    const sOk = s && Date.now() - s.ts < 5000;
    const pOk = pr && Date.now() - pr.ts < 5000;
    return `${p.symbol}-spot:${sOk ? '✓' : '✗'} ${p.symbol}-perp:${pOk ? '✓' : '✗'}`;
  }).join(' ');

  const payload = {
    snapshot_time:        new Date().toISOString(),
    evaluations:          snap.evaluations,
    posted:               snap.posted,
    rejected_edge:        snap.rejected_edge,
    rejected_fillable:    snap.rejected_fillable,
    rejected_stale:       snap.rejected_stale,
    rejected_dedupe:      snap.rejected_dedupe,
    best_edge_bps:        snap.best_edge_bps,
    best_edge_pair:       snap.best_edge_pair,
    best_edge_route:      snap.best_edge_route,
    bucket_0_5:           snap.bucket_0_5,
    bucket_5_10:          snap.bucket_5_10,
    bucket_10_15:         snap.bucket_10_15,
    bucket_15_20:         snap.bucket_15_20,
    bucket_20_plus:       snap.bucket_20_plus,
    fresh_books:          freshParts,
    min_edge_floor_bps:   MIN_EDGE_BPS,
    venue_pair_checks:    snap.venue_pair_checks,
    venue_no_book:        snap.venue_no_book,
    venue_stale_book:     snap.venue_stale_book,
    passed_edge_gate:     snap.passed_edge_gate,
    passed_fillable_gate: snap.passed_fillable_gate,
    passed_stale_gate:    snap.passed_stale_gate,
    passed_dedupe_gate:   snap.passed_dedupe_gate,
    post_attempts:        snap.post_attempts,
    post_errors:          snap.post_errors,
    post_non_2xx:         snap.post_non_2xx,
  };

  console.log(`💓 evals=${snap.evaluations} posted=${snap.posted} bestEdge=${snap.best_edge_bps.toFixed(2)}bps`);

  axios.post(HEARTBEAT_URL, payload, {
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    timeout: 8000,
  }).then(() => console.log('💓 Heartbeat sent'))
    .catch(e => console.error(`💓 Heartbeat failed: ${e.message}`));
}, 60_000);

console.log('🚀 MBIO Arb Bot started — monitoring BTC/ETH/SOL on OKX spot+perp');