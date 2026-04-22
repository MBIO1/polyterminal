// Serves the current droplet bot.mjs as plain text.
// PUBLIC endpoint — no auth required.
// Usage from droplet:
//   curl -s https://polytrade.base44.app/functions/downloadBot -o /root/arb-ws-bot/bot.mjs
//
// This is the BASIS-CARRY bot: monitors spot vs perp on OKX and Bybit,
// posts signals when basis_bps exceeds threshold (after fees).

const BOT_SOURCE = `import 'dotenv/config';
import WebSocket from 'ws';

const INGEST_URL = process.env.BASE44_INGEST_URL;
const STATS_URL = process.env.BASE44_STATS_URL;
const HEARTBEAT_URL = process.env.BASE44_HEARTBEAT_URL;
const TOKEN = process.env.BASE44_USER_TOKEN;
const PAIRS = (process.env.PAIRS || 'BTC-USDT,ETH-USDT,SOL-USDT,AVAX-USDT,LINK-USDT,DOGE-USDT,ADA-USDT,ATOM-USDT,APT-USDT,SUI-USDT,ARB-USDT,OP-USDT,INJ-USDT,SEI-USDT,TIA-USDT').split(',');
const MIN_NET_EDGE_BPS = Number(process.env.MIN_NET_EDGE_BPS || 3);
const MAX_SIGNAL_AGE_MS = Number(process.env.MAX_SIGNAL_AGE_MS || 1000);
const MIN_FILLABLE_USD = Number(process.env.MIN_FILLABLE_USD || 2000);
const ALERT_EDGE_BPS = Number(process.env.ALERT_EDGE_BPS || 15);
const TAKER_FEE_BPS = Number(process.env.TAKER_FEE_BPS || 2); // ~2 bps per leg (maker execution on OKX/Bybit)
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 60000);
// Cross-venue confirmation: the OTHER venue's basis must be in the SAME direction
// and at least this fraction of the primary venue's basis to earn confirmed_exchanges=2.
// Without confirmation the signal is stamped 1 (and the executor will reject it).
const CONFIRM_MIN_RATIO = Number(process.env.CONFIRM_MIN_RATIO || 0.5);

if (!INGEST_URL || !TOKEN) {
  console.error('Missing BASE44_INGEST_URL or BASE44_USER_TOKEN in .env');
  process.exit(1);
}

const pairThresholds = Object.fromEntries(PAIRS.map(p => [p, MIN_NET_EDGE_BPS]));

// books[venue][pair] = { bid, ask, bidSize, askSize, ts }
// venues: OKX-spot, OKX-perp, Bybit-spot, Bybit-perp
const books = { 'OKX-spot': {}, 'OKX-perp': {}, 'Bybit-spot': {}, 'Bybit-perp': {} };
const recentlyPosted = new Map();
const stats = {
  evaluations: 0, rejected_edge: 0, rejected_fillable: 0,
  rejected_stale: 0, rejected_dedupe: 0, posted: 0,
  best_edge_seen_bps: -Infinity, best_edge_pair: '', best_edge_route: '',
  // Opportunity distribution buckets (counts every evaluation by net edge tier)
  bucket_0_5: 0, bucket_5_10: 0, bucket_10_15: 0, bucket_15_20: 0, bucket_20_plus: 0,
};
function resetStats() {
  for (const k of Object.keys(stats)) {
    if (typeof stats[k] === 'number') stats[k] = k === 'best_edge_seen_bps' ? -Infinity : 0;
    else stats[k] = '';
  }
}
function recordBucket(edgeBps) {
  if (edgeBps < 0) return;
  if (edgeBps < 5) stats.bucket_0_5++;
  else if (edgeBps < 10) stats.bucket_5_10++;
  else if (edgeBps < 15) stats.bucket_10_15++;
  else if (edgeBps < 20) stats.bucket_15_20++;
  else stats.bucket_20_plus++;
}

// OKX spot + perp (swap) on the same WS
function connectOKX() {
  const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
  ws.on('open', () => {
    const args = [];
    for (const p of PAIRS) {
      args.push({ channel: 'tickers', instId: p });                 // spot: BTC-USDT
      args.push({ channel: 'tickers', instId: p + '-SWAP' });       // perp: BTC-USDT-SWAP
    }
    ws.send(JSON.stringify({ op: 'subscribe', args }));
  });
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (!msg.data) return;
    for (const d of msg.data) {
      const isSwap = d.instId.endsWith('-SWAP');
      const pair = isSwap ? d.instId.replace('-SWAP', '') : d.instId;
      if (!PAIRS.includes(pair)) continue;
      const venue = isSwap ? 'OKX-perp' : 'OKX-spot';
      books[venue][pair] = {
        bid: Number(d.bidPx), ask: Number(d.askPx),
        bidSize: Number(d.bidSz) * Number(d.bidPx),
        askSize: Number(d.askSz) * Number(d.askPx),
        ts: Date.now(),
      };
      evaluate(pair);
    }
  });
  ws.on('close', () => setTimeout(connectOKX, 2000));
  ws.on('error', e => console.error('OKX WS:', e.message));
}

// Bybit spot (separate WS endpoint)
// Bybit spot uses orderbook.1 channel (tickers channel has no bid/ask fields)
function connectBybitSpot() {
  const venue = 'Bybit-spot';
  const ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');
  ws.on('open', () => ws.send(JSON.stringify({ op: 'subscribe', args: PAIRS.map(p => 'orderbook.1.' + p.replace('-', '')) })));
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (!msg.topic || !msg.data) return;
    const sym = msg.topic.split('.')[2];
    const pair = PAIRS.find(p => p.replace('-', '') === sym);
    if (!pair) return;
    const d = msg.data;
    // orderbook.1 format: { b: [[price, size]], a: [[price, size]], s: symbol }
    const bidLevel = d.b && d.b[0];
    const askLevel = d.a && d.a[0];
    const existing = books[venue][pair] || {};
    const bid = bidLevel && bidLevel[0] ? Number(bidLevel[0]) : existing.bid;
    const ask = askLevel && askLevel[0] ? Number(askLevel[0]) : existing.ask;
    if (!bid || !ask) return;
    const bidQty = bidLevel && bidLevel[1] ? Number(bidLevel[1]) : (existing.bid ? (existing.bidSize || 0) / existing.bid : 0);
    const askQty = askLevel && askLevel[1] ? Number(askLevel[1]) : (existing.ask ? (existing.askSize || 0) / existing.ask : 0);
    books[venue][pair] = {
      bid, ask,
      bidSize: bidQty * bid,
      askSize: askQty * ask,
      ts: Date.now(),
    };
    evaluate(pair);
  });
  ws.on('close', () => setTimeout(connectBybitSpot, 2000));
  ws.on('error', e => console.error(venue + ' WS:', e.message));
}

function bybitTickerWS(kind, url) {
  const venue = 'Bybit-' + kind;
  const ws = new WebSocket(url);
  ws.on('open', () => ws.send(JSON.stringify({ op: 'subscribe', args: PAIRS.map(p => 'tickers.' + p.replace('-', '')) })));
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (!msg.topic || !msg.data) return;
    const sym = msg.topic.split('.')[1];
    const pair = PAIRS.find(p => p.replace('-', '') === sym);
    if (!pair) return;
    const d = msg.data;
    const existing = books[venue][pair] || {};
    const parseOr = (v, fallback) => {
      if (v === undefined || v === null || v === '') return fallback;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    const bid = parseOr(d.bid1Price, existing.bid);
    const ask = parseOr(d.ask1Price, existing.ask);
    if (!bid || !ask) return;
    const bidSzQty = parseOr(d.bid1Size, existing.bid ? (existing.bidSize || 0) / existing.bid : 0);
    const askSzQty = parseOr(d.ask1Size, existing.ask ? (existing.askSize || 0) / existing.ask : 0);
    books[venue][pair] = {
      bid, ask,
      bidSize: bidSzQty * bid,
      askSize: askSzQty * ask,
      ts: Date.now(),
    };
    evaluate(pair);
  });
  ws.on('close', () => setTimeout(() => bybitTickerWS(kind, url), 2000));
  ws.on('error', e => console.error(venue + ' WS:', e.message));
}

function connectBybitPerp() { bybitTickerWS('perp', 'wss://stream.bybit.com/v5/public/linear'); }

// Compute mid-based basis for a venue: (perp_mid - spot_mid) / spot_mid, in bps.
// Positive = contango, negative = backwardation. Returns null if books are missing/stale.
function venueBasisBps(venue, pair, now) {
  const spot = books[venue + '-spot'][pair];
  const perp = books[venue + '-perp'][pair];
  if (!spot || !perp) return null;
  if (now - spot.ts > MAX_SIGNAL_AGE_MS || now - perp.ts > MAX_SIGNAL_AGE_MS) return null;
  const spotMid = (spot.bid + spot.ask) / 2;
  const perpMid = (perp.bid + perp.ask) / 2;
  if (!spotMid) return null;
  return ((perpMid - spotMid) / spotMid) * 10000;
}

// Bidirectional basis evaluation (contango + backwardation).
// CONTANGO (perp > spot): long spot / short perp  -> buy spot.ask, sell perp.bid
// BACKWARDATION (spot > perp): short spot / long perp -> buy perp.ask, sell spot.bid (margin-short the spot leg)
function evaluate(pair) {
  const now = Date.now();
  stats.evaluations++;
  const venues = ['OKX', 'Bybit'];
  for (const venue of venues) {
    const spot = books[venue + '-spot'][pair];
    const perp = books[venue + '-perp'][pair];
    if (!spot || !perp) continue;
    if (now - spot.ts > MAX_SIGNAL_AGE_MS || now - perp.ts > MAX_SIGNAL_AGE_MS) continue;

    // Two candidate legs
    const contangoBps = ((perp.bid - spot.ask) / spot.ask) * 10000;
    const backwardBps = ((spot.bid - perp.ask) / perp.ask) * 10000;

    // Pick the larger of the two opportunities
    let rawSpreadBps, buyVenue, sellVenue, buyPx, sellPx, buyDepth, sellDepth, notes, direction;
    if (contangoBps >= backwardBps) {
      rawSpreadBps = contangoBps;
      buyVenue = venue + '-spot'; sellVenue = venue + '-perp';
      buyPx = spot.ask; sellPx = perp.bid;
      buyDepth = spot.askSize; sellDepth = perp.bidSize;
      notes = 'basis carry: long spot / short perp (contango)';
      direction = 'contango';
    } else {
      rawSpreadBps = backwardBps;
      buyVenue = venue + '-perp'; sellVenue = venue + '-spot';
      buyPx = perp.ask; sellPx = spot.bid;
      buyDepth = perp.askSize; sellDepth = spot.bidSize;
      notes = 'reverse basis: long perp / short spot (backwardation)';
      direction = 'backwardation';
    }

    // Cross-venue confirmation: compare this venue's basis to the OTHER venue's basis.
    // Confirmed iff the other venue's basis is in the SAME direction (sign) AND
    // its magnitude is >= CONFIRM_MIN_RATIO × this venue's magnitude.
    const otherVenue = venue === 'OKX' ? 'Bybit' : 'OKX';
    const thisBasis = direction === 'contango' ? contangoBps : -backwardBps; // signed
    const otherBasis = venueBasisBps(otherVenue, pair, now);
    let confirmedExchanges = 1;
    let confirmNote = otherBasis === null
      ? 'unconfirmed (' + otherVenue + ' book stale/missing)'
      : 'unconfirmed (' + otherVenue + '=' + otherBasis.toFixed(2) + 'bps)';
    if (otherBasis !== null && Math.sign(otherBasis) === Math.sign(thisBasis) &&
        Math.abs(otherBasis) >= CONFIRM_MIN_RATIO * Math.abs(thisBasis)) {
      confirmedExchanges = 2;
      confirmNote = 'confirmed by ' + otherVenue + ' (' + otherBasis.toFixed(2) + 'bps vs ' + thisBasis.toFixed(2) + 'bps)';
    }
    notes = notes + ' | ' + confirmNote;

    // Round-trip cost: 4 legs (spot entry + perp entry + spot exit + perp exit)
    const netEdgeBps = rawSpreadBps - 4 * TAKER_FEE_BPS;

    if (netEdgeBps > stats.best_edge_seen_bps) {
      stats.best_edge_seen_bps = netEdgeBps;
      stats.best_edge_pair = pair;
      stats.best_edge_route = buyVenue + '->' + sellVenue;
    }
    recordBucket(netEdgeBps);

    const threshold = pairThresholds[pair] || MIN_NET_EDGE_BPS;
    if (netEdgeBps < threshold) { stats.rejected_edge++; continue; }

    const fillable = Math.min(buyDepth, sellDepth);
    if (fillable < MIN_FILLABLE_USD) { stats.rejected_fillable++; continue; }

    const signalAgeMs = now - Math.min(spot.ts, perp.ts);
    if (signalAgeMs > MAX_SIGNAL_AGE_MS) { stats.rejected_stale++; continue; }

    const key = pair + '|' + buyVenue + '|' + sellVenue;
    const last = recentlyPosted.get(key);
    if (last && now - last < 20000) { stats.rejected_dedupe++; continue; }
    recentlyPosted.set(key, now);
    stats.posted++;

    post({
      pair, asset: pair.split('-')[0],
      buy_exchange: buyVenue, sell_exchange: sellVenue,
      buy_price: buyPx, sell_price: sellPx,
      raw_spread_bps: rawSpreadBps, net_edge_bps: netEdgeBps,
      buy_depth_usd: buyDepth, sell_depth_usd: sellDepth,
      fillable_size_usd: fillable, signal_age_ms: signalAgeMs,
      exchange_latency_ms: 0, confirmed_exchanges: confirmedExchanges,
      signal_time: new Date().toISOString(),
      alert: netEdgeBps >= ALERT_EDGE_BPS && confirmedExchanges === 2,
      notes: notes,
    });
  }
}

async function post(payload) {
  try {
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    const dupFlag = body.duplicate ? '(dup)' : (body.signal_id || '');
    console.log('[' + payload.pair + '] ' + payload.buy_exchange + '->' + payload.sell_exchange + ' ' + payload.net_edge_bps.toFixed(2) + 'bps fillable=$' + Math.round(payload.fillable_size_usd) + ' -> ' + res.status + ' ' + dupFlag);
  } catch (e) { console.error('POST failed:', e.message); }
}

async function refreshThresholds() {
  if (!STATS_URL) return;
  try {
    const res = await fetch(STATS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify({ window_hours: 24 }),
    });
    const data = await res.json();
    if (!data || !data.pairs) return;
    for (const s of data.pairs) {
      if (s.recommended_min_bps && PAIRS.includes(s.pair)) {
        const old = pairThresholds[s.pair];
        // Respect the env floor: stats can only RAISE the threshold, never lower it below MIN_NET_EDGE_BPS
        const next = Math.max(s.recommended_min_bps, MIN_NET_EDGE_BPS);
        pairThresholds[s.pair] = next;
        if (old !== next) console.log('[threshold] ' + s.pair + ': ' + old + ' -> ' + next + ' bps (floor=' + MIN_NET_EDGE_BPS + ', rec=' + s.recommended_min_bps + ')');
      }
    }
  } catch (e) { console.error('refreshThresholds:', e.message); }
}

setInterval(() => { const cutoff = Date.now() - 60000; for (const [k, v] of recentlyPosted) if (v < cutoff) recentlyPosted.delete(k); }, 30000);
setInterval(refreshThresholds, 15 * 60000);

async function postHeartbeat(freshBooks) {
  if (!HEARTBEAT_URL) return;
  try {
    const payload = {
      snapshot_time: new Date().toISOString(),
      evaluations: stats.evaluations, posted: stats.posted,
      rejected_edge: stats.rejected_edge, rejected_fillable: stats.rejected_fillable,
      rejected_stale: stats.rejected_stale, rejected_dedupe: stats.rejected_dedupe,
      best_edge_bps: stats.best_edge_seen_bps > -Infinity ? stats.best_edge_seen_bps : 0,
      best_edge_pair: stats.best_edge_pair, best_edge_route: stats.best_edge_route,
      bucket_0_5: stats.bucket_0_5, bucket_5_10: stats.bucket_5_10,
      bucket_10_15: stats.bucket_10_15, bucket_15_20: stats.bucket_15_20,
      bucket_20_plus: stats.bucket_20_plus,
      fresh_books: freshBooks, min_edge_floor_bps: MIN_NET_EDGE_BPS,
    };
    await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify(payload),
    });
  } catch (e) { console.error('heartbeat POST failed:', e.message); }
}

setInterval(() => {
  const now = Date.now();
  const conns = Object.entries(books).map(([v, pairs]) => {
    const freshCount = Object.values(pairs).filter(b => now - b.ts < MAX_SIGNAL_AGE_MS * 5).length;
    return v + ':' + freshCount + '/' + PAIRS.length;
  }).join(' ');
  const best = stats.best_edge_seen_bps > -Infinity
    ? 'best=' + stats.best_edge_seen_bps.toFixed(2) + 'bps ' + stats.best_edge_pair + ' ' + stats.best_edge_route
    : 'best=none';
  const dist = 'dist[<5=' + stats.bucket_0_5 + ' 5-10=' + stats.bucket_5_10 + ' 10-15=' + stats.bucket_10_15 + ' 15-20=' + stats.bucket_15_20 + ' 20+=' + stats.bucket_20_plus + ']';
  console.log('[heartbeat] evals=' + stats.evaluations + ' posted=' + stats.posted + ' rej(edge=' + stats.rejected_edge + ' fill=' + stats.rejected_fillable + ' stale=' + stats.rejected_stale + ' dup=' + stats.rejected_dedupe + ') ' + best + ' ' + dist + ' | ' + conns);
  postHeartbeat(conns);
  resetStats();
}, HEARTBEAT_MS);

console.log('Arb BASIS-CARRY bot v3 (BIDIRECTIONAL + CROSS-VENUE CONFIRMATION) starting - pairs: ' + PAIRS.join(', ') + ' - min edge: ' + MIN_NET_EDGE_BPS + 'bps - confirm ratio: ' + CONFIRM_MIN_RATIO + ' - min fillable: $' + MIN_FILLABLE_USD + ' - max age: ' + MAX_SIGNAL_AGE_MS + 'ms');
connectOKX(); connectBybitSpot(); connectBybitPerp(); refreshThresholds();
`;

Deno.serve(() => {
  return new Response(BOT_SOURCE, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
});