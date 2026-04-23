// Serves the current droplet bot.mjs as plain text.
// PUBLIC endpoint — no auth required.
// Usage from droplet:
//   curl -s https://polytrade.base44.app/functions/downloadBot -o /root/arb-ws-bot/bot.mjs
//
// This is the BASIS-CARRY bot: monitors spot vs perp on OKX and Bybit,
// posts signals when basis_bps exceeds threshold (after fees).

const BOT_SOURCE = `// Arb BASIS-CARRY bot v3 — auto-downloaded from Base44
import 'dotenv/config';
import WebSocket from 'ws';

const INGEST_URL = process.env.BASE44_INGEST_URL;
const STATS_URL = process.env.BASE44_STATS_URL;
const HEARTBEAT_URL = process.env.BASE44_HEARTBEAT_URL;
const TOKEN = process.env.BASE44_USER_TOKEN;
const PAIRS = (process.env.PAIRS || 'BTC-USDT,ETH-USDT,SOL-USDT,AVAX-USDT,LINK-USDT,DOGE-USDT,ADA-USDT,ATOM-USDT,APT-USDT,SUI-USDT,ARB-USDT,OP-USDT,INJ-USDT,SEI-USDT,TIA-USDT').split(',');
// Tuned for dense signal flow + $1k capital. Executor (Base44) still gates on ArbConfig
// thresholds, so a permissive bot floor = more visibility, not more risk.
const MIN_NET_EDGE_BPS = Number(process.env.MIN_NET_EDGE_BPS || 2);
const MAX_SIGNAL_AGE_MS = Number(process.env.MAX_SIGNAL_AGE_MS || 1500);
const MIN_FILLABLE_USD = Number(process.env.MIN_FILLABLE_USD || 100);
const ALERT_EDGE_BPS = Number(process.env.ALERT_EDGE_BPS || 15);
// CRITICAL: must equal ArbConfig.taker_fee_bps_per_leg in Base44. Default 5 bps = realistic
// retail taker rate on OKX/Bybit spot+perp. Signals assume 4-leg round-trip cost = 4×this.
// A 10 bps raw spread only yields net edge of 10 - 4×5 = -10 bps (i.e. loss) — so bot will
// correctly reject it. Only true opportunities (> 20 bps raw) survive.
const TAKER_FEE_BPS = Number(process.env.TAKER_FEE_BPS || 5);
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
// venues: OKX-spot, OKX-perp, Bybit-spot, Bybit-perp, Binance-spot, Binance-perp
const books = { 'OKX-spot': {}, 'OKX-perp': {}, 'Bybit-spot': {}, 'Bybit-perp': {}, 'Binance-spot': {}, 'Binance-perp': {} };
const recentlyPosted = new Map();
const stats = {
  evaluations: 0, rejected_edge: 0, rejected_fillable: 0,
  rejected_stale: 0, rejected_dedupe: 0, posted: 0,
  best_edge_seen_bps: -Infinity, best_edge_pair: '', best_edge_route: '',
  // Opportunity distribution buckets (counts every evaluation by net edge tier)
  bucket_0_5: 0, bucket_5_10: 0, bucket_10_15: 0, bucket_15_20: 0, bucket_20_plus: 0,
  // Granular funnel counters — tell us EXACTLY where signals die between evaluation and post.
  venue_pair_checks: 0, venue_no_book: 0, venue_stale_book: 0,
  passed_edge_gate: 0, passed_fillable_gate: 0, passed_stale_gate: 0, passed_dedupe_gate: 0,
  post_attempts: 0, post_errors: 0, post_non_2xx: 0,
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
// Subscribes to pairs ONE AT A TIME so that a pair that doesn't exist on Bybit spot
// (e.g. SEI, TIA, INJ listed on derivatives only) does NOT kill the batch subscription
// and leave Bybit-spot feeds empty. Also logs topic-level errors from Bybit.
function connectBybitSpot() {
  const venue = 'Bybit-spot';
  const ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');
  ws.on('open', () => {
    for (const p of PAIRS) {
      const topic = 'orderbook.1.' + p.replace('-', '');
      ws.send(JSON.stringify({ op: 'subscribe', args: [topic] }));
    }
  });
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    // Log subscription failures per-topic so we can see which pairs are not on Bybit spot
    if (msg.op === 'subscribe' && msg.success === false) {
      console.error(venue + ' subscribe failed:', msg.ret_msg || msg.retMsg || JSON.stringify(msg));
      return;
    }
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
  // Subscribe per-topic to survive individual pair errors (same as Bybit spot).
  ws.on('open', () => {
    for (const p of PAIRS) {
      const topic = 'tickers.' + p.replace('-', '');
      ws.send(JSON.stringify({ op: 'subscribe', args: [topic] }));
    }
  });
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.op === 'subscribe' && msg.success === false) {
      console.error(venue + ' subscribe failed:', msg.ret_msg || msg.retMsg || JSON.stringify(msg));
      return;
    }
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

// Binance spot + perp (USD-M futures).
// Uses the combined-stream endpoint with @bookTicker (pushes top-of-book on every change).
// Spot:  wss://stream.binance.com:9443/stream?streams=btcusdt@bookTicker/ethusdt@bookTicker/...
// Perp:  wss://fstream.binance.com/stream?streams=btcusdt@bookTicker/...
function binanceWS(kind, baseUrl) {
  const venue = 'Binance-' + kind;
  const streams = PAIRS.map(p => p.replace('-', '').toLowerCase() + '@bookTicker').join('/');
  const url = baseUrl + '/stream?streams=' + streams;
  const ws = new WebSocket(url);
  ws.on('open', () => console.log(venue + ' WS connected (' + PAIRS.length + ' pairs)'));
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    const d = msg.data;
    if (!d || !d.s) return;
    const sym = d.s; // e.g. BTCUSDT
    const pair = PAIRS.find(p => p.replace('-', '') === sym);
    if (!pair) return;
    const bid = Number(d.b);
    const ask = Number(d.a);
    const bidQty = Number(d.B);
    const askQty = Number(d.A);
    if (!bid || !ask) return;
    books[venue][pair] = {
      bid, ask,
      bidSize: bidQty * bid,
      askSize: askQty * ask,
      ts: Date.now(),
    };
    evaluate(pair);
  });
  ws.on('close', () => setTimeout(() => binanceWS(kind, baseUrl), 2000));
  ws.on('error', e => console.error(venue + ' WS:', e.message));
}

function connectBinanceSpot() { binanceWS('spot', 'wss://stream.binance.com:9443'); }
function connectBinancePerp() { binanceWS('perp', 'wss://fstream.binance.com'); }

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
  const venues = ['OKX', 'Bybit', 'Binance'];
  for (const venue of venues) {
    stats.venue_pair_checks++;
    const spot = books[venue + '-spot'][pair];
    const perp = books[venue + '-perp'][pair];
    if (!spot || !perp) { stats.venue_no_book++; continue; }
    if (now - spot.ts > MAX_SIGNAL_AGE_MS || now - perp.ts > MAX_SIGNAL_AGE_MS) { stats.venue_stale_book++; continue; }

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

    // Cross-venue confirmation: compare this venue's basis against ALL other venues.
    // Each other venue whose basis matches sign and magnitude adds to the count.
    const thisBasis = direction === 'contango' ? contangoBps : -backwardBps; // signed
    const otherVenues = venues.filter(v => v !== venue);
    let confirmedExchanges = 1;
    const confirmParts = [];
    for (const other of otherVenues) {
      const otherBasis = venueBasisBps(other, pair, now);
      if (otherBasis === null) {
        confirmParts.push(other + '=stale');
        continue;
      }
      const matches = Math.sign(otherBasis) === Math.sign(thisBasis) &&
        Math.abs(otherBasis) >= CONFIRM_MIN_RATIO * Math.abs(thisBasis);
      if (matches) {
        confirmedExchanges++;
        confirmParts.push(other + '✓' + otherBasis.toFixed(1));
      } else {
        confirmParts.push(other + '=' + otherBasis.toFixed(1));
      }
    }
    notes = notes + ' | confirms=' + confirmedExchanges + ' [' + confirmParts.join(',') + ']';

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
    stats.passed_edge_gate++;

    const fillable = Math.min(buyDepth, sellDepth);
    if (fillable < MIN_FILLABLE_USD) { stats.rejected_fillable++; continue; }
    stats.passed_fillable_gate++;

    const signalAgeMs = now - Math.min(spot.ts, perp.ts);
    if (signalAgeMs > MAX_SIGNAL_AGE_MS) { stats.rejected_stale++; continue; }
    stats.passed_stale_gate++;

    const key = pair + '|' + buyVenue + '|' + sellVenue;
    const last = recentlyPosted.get(key);
    if (last && now - last < 5000) { stats.rejected_dedupe++; continue; }
    stats.passed_dedupe_gate++;
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

  // ---------- Cross-venue SPOT/SPOT scanner ----------
  // Scan ALL venue pairs (OKX/Bybit/Binance). For each pair, find the cheapest ask and
  // richest bid. Buy on cheap venue, sell on rich venue. Signals are tagged "Cross-venue Spot Spread".
  const spotVenues = [
    { name: 'OKX-spot', book: books['OKX-spot'][pair] },
    { name: 'Bybit-spot', book: books['Bybit-spot'][pair] },
    { name: 'Binance-spot', book: books['Binance-spot'][pair] },
  ].filter(v => v.book && now - v.book.ts <= MAX_SIGNAL_AGE_MS);

  if (spotVenues.length >= 2) {
    // Cheapest ask (where we'd buy) and richest bid (where we'd sell)
    let cheapest = spotVenues[0], richest = spotVenues[0];
    for (const v of spotVenues) {
      if (v.book.ask < cheapest.book.ask) cheapest = v;
      if (v.book.bid > richest.book.bid) richest = v;
    }
    if (cheapest.name !== richest.name) {
      const rawBps = ((richest.book.bid - cheapest.book.ask) / cheapest.book.ask) * 10000;
      const buyVenue = cheapest.name, sellVenue = richest.name;
      const buyPx = cheapest.book.ask, sellPx = richest.book.bid;
      const buyDepth = cheapest.book.askSize, sellDepth = richest.book.bidSize;
      const netBps = rawBps - 4 * TAKER_FEE_BPS;

      if (netBps > stats.best_edge_seen_bps) {
        stats.best_edge_seen_bps = netBps;
        stats.best_edge_pair = pair;
        stats.best_edge_route = buyVenue + '->' + sellVenue;
      }
      recordBucket(netBps);

      const threshold = pairThresholds[pair] || MIN_NET_EDGE_BPS;
      if (netBps >= threshold) {
        const fillable = Math.min(buyDepth, sellDepth);
        const signalAgeMs = now - Math.min(cheapest.book.ts, richest.book.ts);
        const key = pair + '|' + buyVenue + '|' + sellVenue;
        const last = recentlyPosted.get(key);
        const isDupe = last && now - last < 5000;
        if (fillable >= MIN_FILLABLE_USD && signalAgeMs <= MAX_SIGNAL_AGE_MS && !isDupe) {
          recentlyPosted.set(key, now);
          stats.posted++;
          post({
            pair, asset: pair.split('-')[0],
            buy_exchange: buyVenue, sell_exchange: sellVenue,
            buy_price: buyPx, sell_price: sellPx,
            raw_spread_bps: rawBps, net_edge_bps: netBps,
            buy_depth_usd: buyDepth, sell_depth_usd: sellDepth,
            fillable_size_usd: fillable, signal_age_ms: signalAgeMs,
            exchange_latency_ms: 0,
            confirmed_exchanges: spotVenues.length, // how many spot venues were live
            signal_time: new Date().toISOString(),
            alert: netBps >= ALERT_EDGE_BPS,
            notes: 'cross-venue spot/spot (' + spotVenues.length + '-venue scan)',
          });
        } else if (isDupe) stats.rejected_dedupe++;
        else if (fillable < MIN_FILLABLE_USD) stats.rejected_fillable++;
        else stats.rejected_stale++;
      } else {
        stats.rejected_edge++;
      }
    }
  }
}

async function post(payload) {
  stats.post_attempts++;
  try {
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify(payload),
    });
    if (res.status < 200 || res.status >= 300) {
      stats.post_non_2xx++;
      const errText = await res.text().catch(() => '');
      console.error('POST non-2xx ' + res.status + ' for [' + payload.pair + ']: ' + errText.slice(0, 200));
      return;
    }
    const body = await res.json();
    const dupFlag = body.duplicate ? '(dup)' : (body.signal_id || '');
    console.log('[' + payload.pair + '] ' + payload.buy_exchange + '->' + payload.sell_exchange + ' ' + payload.net_edge_bps.toFixed(2) + 'bps fillable=$' + Math.round(payload.fillable_size_usd) + ' -> ' + res.status + ' ' + dupFlag);
  } catch (e) {
    stats.post_errors++;
    console.error('POST failed:', e.message);
  }
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
      venue_pair_checks: stats.venue_pair_checks,
      venue_no_book: stats.venue_no_book,
      venue_stale_book: stats.venue_stale_book,
      passed_edge_gate: stats.passed_edge_gate,
      passed_fillable_gate: stats.passed_fillable_gate,
      passed_stale_gate: stats.passed_stale_gate,
      passed_dedupe_gate: stats.passed_dedupe_gate,
      post_attempts: stats.post_attempts,
      post_errors: stats.post_errors,
      post_non_2xx: stats.post_non_2xx,
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
  const funnel = 'funnel[checks=' + stats.venue_pair_checks + ' nobook=' + stats.venue_no_book + ' stalebook=' + stats.venue_stale_book + ' edge✓=' + stats.passed_edge_gate + ' fill✓=' + stats.passed_fillable_gate + ' age✓=' + stats.passed_stale_gate + ' dedup✓=' + stats.passed_dedupe_gate + ' post=' + stats.post_attempts + ' err=' + stats.post_errors + ' non2xx=' + stats.post_non_2xx + ']';
  console.log('[heartbeat] evals=' + stats.evaluations + ' posted=' + stats.posted + ' rej(edge=' + stats.rejected_edge + ' fill=' + stats.rejected_fillable + ' stale=' + stats.rejected_stale + ' dup=' + stats.rejected_dedupe + ') ' + best + ' ' + dist + ' ' + funnel + ' | ' + conns);
  postHeartbeat(conns);
  resetStats();
}, HEARTBEAT_MS);

console.log('Arb BASIS-CARRY bot v3 (BIDIRECTIONAL + CROSS-VENUE CONFIRMATION) starting - pairs: ' + PAIRS.join(', ') + ' - min edge: ' + MIN_NET_EDGE_BPS + 'bps - confirm ratio: ' + CONFIRM_MIN_RATIO + ' - min fillable: $' + MIN_FILLABLE_USD + ' - max age: ' + MAX_SIGNAL_AGE_MS + 'ms');
connectOKX(); connectBybitSpot(); connectBybitPerp(); connectBinanceSpot(); connectBinancePerp(); refreshThresholds();
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