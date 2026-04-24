// Serves the current droplet bot.mjs as plain text.
// PUBLIC endpoint — no auth required.
// Usage from droplet:
//   curl -s https://polytrade.base44.app/functions/downloadBot -o /root/arb-ws-bot/bot.mjs && systemctl restart arb-bot

const BOT_SOURCE = `// Droplet WebSocket arbitrage bot — BASIS-CARRY v3 (BIDIRECTIONAL + CROSS-VENUE CONFIRMATION)
// Auto-downloaded from Base44. Start: node bot.mjs
//
// ─── FEE MODEL (critical — must be consistent everywhere) ────────────────────
// A round-trip basis carry has 4 legs:
//   leg 1: entry buy taker (spot or perp)
//   leg 2: entry sell taker (spot or perp)
//   leg 3: exit buy taker
//   leg 4: exit sell taker
// net_edge_bps = raw_spread_bps - 4 × TAKER_FEE_BPS
//
// This MUST match:
//   • ArbConfig.taker_fee_bps_per_leg (Base44 UI)
//   • executeSignals backend function (4 × config.taker_fee_bps_per_leg)
//   • ingestSignal Telegram message (4 × 2 = 8 bps shown)
//
// ─── ALERT THRESHOLD alignment ───────────────────────────────────────────────
// ALERT_EDGE_BPS (default 20) = net_edge at which alert=true is sent in the signal payload.
// ingestSignal fires Telegram/Slack when alert=true (TELEGRAM_ALERT_MIN_BPS = 20 bps).
// Keep ALERT_EDGE_BPS = TELEGRAM_ALERT_MIN_BPS to avoid false alerts.

import 'dotenv/config';
import WebSocket from 'ws';

const INGEST_URL      = process.env.BASE44_INGEST_URL;
const HEARTBEAT_URL   = process.env.BASE44_HEARTBEAT_URL;
const STATS_URL       = process.env.BASE44_STATS_URL;
const TOKEN           = process.env.BASE44_USER_TOKEN;

const PAIRS = (process.env.PAIRS || 'BTC-USDT,ETH-USDT,SOL-USDT,AVAX-USDT,LINK-USDT,DOGE-USDT,ADA-USDT,ATOM-USDT,APT-USDT,SUI-USDT,ARB-USDT,OP-USDT,INJ-USDT,SEI-USDT,TIA-USDT').split(',');

// TAKER_FEE_BPS: per-leg taker fee. MUST match ArbConfig.taker_fee_bps_per_leg in Base44 (default 2).
const TAKER_FEE_BPS     = Number(process.env.TAKER_FEE_BPS || 2);

// MIN_NET_EDGE_BPS: minimum net edge (post 4-leg fees) to post a signal.
// Keep low (1–2 bps) for visibility; the executor gates on ArbConfig thresholds.
const MIN_NET_EDGE_BPS  = Number(process.env.MIN_NET_EDGE_BPS || 2);

// ALERT_EDGE_BPS: net edge at which alert=true fires Telegram/Slack.
// Must match TELEGRAM_ALERT_MIN_BPS in ingestSignal (20 bps).
const ALERT_EDGE_BPS    = Number(process.env.ALERT_EDGE_BPS || 20);

const MAX_SIGNAL_AGE_MS = Number(process.env.MAX_SIGNAL_AGE_MS || 1500);
const MIN_FILLABLE_USD  = Number(process.env.MIN_FILLABLE_USD || 100);
const HEARTBEAT_MS      = Number(process.env.HEARTBEAT_MS || 60_000);
const CONFIRM_MIN_RATIO = Number(process.env.CONFIRM_MIN_RATIO || 0.5);

// Set DISABLE_BINANCE=true in .env if running from a US-based server (HTTP 451 geo-block).
const DISABLE_BINANCE = process.env.DISABLE_BINANCE === 'true';

if (!INGEST_URL || !TOKEN) {
  console.error('Missing BASE44_INGEST_URL or BASE44_USER_TOKEN in .env');
  process.exit(1);
}

const pairThresholds = Object.fromEntries(PAIRS.map(p => [p, MIN_NET_EDGE_BPS]));

const books = {
  'OKX-spot': {}, 'OKX-perp': {},
  'Bybit-spot': {}, 'Bybit-perp': {},
  ...(DISABLE_BINANCE ? {} : { 'Binance-spot': {}, 'Binance-perp': {} }),
};

const recentlyPosted = new Map();

const stats = {
  evaluations: 0, rejected_edge: 0, rejected_fillable: 0,
  rejected_stale: 0, rejected_dedupe: 0, posted: 0,
  best_edge_seen_bps: -Infinity, best_edge_pair: '', best_edge_route: '',
  bucket_0_5: 0, bucket_5_10: 0, bucket_10_15: 0, bucket_15_20: 0, bucket_20_plus: 0,
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
  if (edgeBps < 5)       stats.bucket_0_5++;
  else if (edgeBps < 10) stats.bucket_5_10++;
  else if (edgeBps < 15) stats.bucket_10_15++;
  else if (edgeBps < 20) stats.bucket_15_20++;
  else                   stats.bucket_20_plus++;
}

// OKX spot + perp (swap) on the same WS
function connectOKX() {
  const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
  ws.on('open', () => {
    const args = [];
    for (const p of PAIRS) {
      args.push({ channel: 'tickers', instId: p });          // spot: BTC-USDT
      args.push({ channel: 'tickers', instId: p + '-SWAP' }); // perp: BTC-USDT-SWAP
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

// Bybit spot — uses orderbook.1, subscribed per-pair to survive missing pairs
function connectBybitSpot() {
  const venue = 'Bybit-spot';
  const ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');
  ws.on('open', () => {
    for (const p of PAIRS) {
      ws.send(JSON.stringify({ op: 'subscribe', args: ['orderbook.1.' + p.replace('-', '')] }));
    }
  });
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.op === 'subscribe' && msg.success === false) {
      console.error(venue + ' subscribe failed:', msg.ret_msg || JSON.stringify(msg));
      return;
    }
    if (!msg.topic || !msg.data) return;
    const sym = msg.topic.split('.')[2];
    const pair = PAIRS.find(p => p.replace('-', '') === sym);
    if (!pair) return;
    const d = msg.data;
    const bidLevel = d.b && d.b[0];
    const askLevel = d.a && d.a[0];
    const existing = books[venue][pair] || {};
    const bid = bidLevel?.[0] ? Number(bidLevel[0]) : existing.bid;
    const ask = askLevel?.[0] ? Number(askLevel[0]) : existing.ask;
    if (!bid || !ask) return;
    const bidQty = bidLevel?.[1] ? Number(bidLevel[1]) : (existing.bid ? (existing.bidSize || 0) / existing.bid : 0);
    const askQty = askLevel?.[1] ? Number(askLevel[1]) : (existing.ask ? (existing.askSize || 0) / existing.ask : 0);
    books[venue][pair] = { bid, ask, bidSize: bidQty * bid, askSize: askQty * ask, ts: Date.now() };
    evaluate(pair);
  });
  ws.on('close', () => setTimeout(connectBybitSpot, 2000));
  ws.on('error', e => console.error(venue + ' WS:', e.message));
}

// Bybit linear perp — tickers channel
function connectBybitPerp() {
  const venue = 'Bybit-perp';
  const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
  ws.on('open', () => {
    for (const p of PAIRS) {
      ws.send(JSON.stringify({ op: 'subscribe', args: ['tickers.' + p.replace('-', '')] }));
    }
  });
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.op === 'subscribe' && msg.success === false) {
      console.error(venue + ' subscribe failed:', msg.ret_msg || JSON.stringify(msg));
      return;
    }
    if (!msg.topic || !msg.data) return;
    const sym = msg.topic.split('.')[1];
    const pair = PAIRS.find(p => p.replace('-', '') === sym);
    if (!pair) return;
    const d = msg.data;
    const existing = books[venue][pair] || {};
    const parseOr = (v, fb) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : fb; };
    const bid = parseOr(d.bid1Price, existing.bid);
    const ask = parseOr(d.ask1Price, existing.ask);
    if (!bid || !ask) return;
    const bidSz = parseOr(d.bid1Size, existing.bid ? (existing.bidSize || 0) / existing.bid : 0);
    const askSz = parseOr(d.ask1Size, existing.ask ? (existing.askSize || 0) / existing.ask : 0);
    books[venue][pair] = { bid, ask, bidSize: bidSz * bid, askSize: askSz * ask, ts: Date.now() };
    evaluate(pair);
  });
  ws.on('close', () => setTimeout(connectBybitPerp, 2000));
  ws.on('error', e => console.error(venue + ' WS:', e.message));
}

// Binance spot + perp via combined-stream @bookTicker
function binanceWS(kind, baseUrl) {
  const venue = 'Binance-' + kind;
  const streams = PAIRS.map(p => p.replace('-', '').toLowerCase() + '@bookTicker').join('/');
  const ws = new WebSocket(baseUrl + '/stream?streams=' + streams);
  ws.on('open', () => console.log(venue + ' WS connected (' + PAIRS.length + ' pairs)'));
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    const d = msg.data;
    if (!d || !d.s) return;
    const pair = PAIRS.find(p => p.replace('-', '') === d.s);
    if (!pair) return;
    const bid = Number(d.b), ask = Number(d.a);
    if (!bid || !ask) return;
    books[venue][pair] = {
      bid, ask,
      bidSize: Number(d.B) * bid,
      askSize: Number(d.A) * ask,
      ts: Date.now(),
    };
    evaluate(pair);
  });
  ws.on('close', () => setTimeout(() => binanceWS(kind, baseUrl), 2000));
  ws.on('error', e => console.error(venue + ' WS:', e.message));
}

function connectBinanceSpot() { binanceWS('spot', 'wss://stream.binance.com:9443'); }
function connectBinancePerp() { binanceWS('perp', 'wss://fstream.binance.com'); }

function venueBasisBps(venue, pair, now) {
  const spot = books[venue + '-spot'] && books[venue + '-spot'][pair];
  const perp = books[venue + '-perp'] && books[venue + '-perp'][pair];
  if (!spot || !perp) return null;
  if (now - spot.ts > MAX_SIGNAL_AGE_MS || now - perp.ts > MAX_SIGNAL_AGE_MS) return null;
  const spotMid = (spot.bid + spot.ask) / 2;
  const perpMid = (perp.bid + perp.ask) / 2;
  if (!spotMid) return null;
  return ((perpMid - spotMid) / spotMid) * 10_000;
}

function evaluate(pair) {
  const now = Date.now();
  stats.evaluations++;
  const venues = DISABLE_BINANCE ? ['OKX', 'Bybit'] : ['OKX', 'Bybit', 'Binance'];

  // Same-venue spot/perp basis carry
  for (const venue of venues) {
    stats.venue_pair_checks++;
    const spot = books[venue + '-spot'][pair];
    const perp = books[venue + '-perp'][pair];
    if (!spot || !perp) { stats.venue_no_book++; continue; }
    if (now - spot.ts > MAX_SIGNAL_AGE_MS || now - perp.ts > MAX_SIGNAL_AGE_MS) { stats.venue_stale_book++; continue; }

    const contangoBps = ((perp.bid  - spot.ask) / spot.ask) * 10_000;
    const backwardBps = ((spot.bid  - perp.ask) / perp.ask) * 10_000;

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

    const thisBasis = direction === 'contango' ? contangoBps : -backwardBps;
    let confirmedExchanges = 1;
    const confirmParts = [];
    for (const other of venues.filter(v => v !== venue)) {
      const otherBasis = venueBasisBps(other, pair, now);
      if (otherBasis === null) { confirmParts.push(other + '=stale'); continue; }
      const matches = Math.sign(otherBasis) === Math.sign(thisBasis) &&
        Math.abs(otherBasis) >= CONFIRM_MIN_RATIO * Math.abs(thisBasis);
      if (matches) { confirmedExchanges++; confirmParts.push(other + '\\u2713' + otherBasis.toFixed(1)); }
      else { confirmParts.push(other + '=' + otherBasis.toFixed(1)); }
    }
    notes += ' | confirms=' + confirmedExchanges + ' [' + confirmParts.join(',') + ']';

    // 4-leg round-trip fee
    const netEdgeBps = rawSpreadBps - 4 * TAKER_FEE_BPS;

    if (netEdgeBps > stats.best_edge_seen_bps) {
      stats.best_edge_seen_bps = netEdgeBps;
      stats.best_edge_pair  = pair;
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
    if (last && now - last < 5_000) { stats.rejected_dedupe++; continue; }
    recentlyPosted.set(key, now);
    stats.passed_dedupe_gate++;
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
      alert: netEdgeBps >= ALERT_EDGE_BPS && confirmedExchanges >= 2,
      notes,
    });
  }

  // Cross-venue spot/spot scanner
  const spotVenues = [
    { name: 'OKX-spot',   book: books['OKX-spot'][pair] },
    { name: 'Bybit-spot', book: books['Bybit-spot'][pair] },
    ...(DISABLE_BINANCE ? [] : [{ name: 'Binance-spot', book: books['Binance-spot'][pair] }]),
  ].filter(v => v.book && now - v.book.ts <= MAX_SIGNAL_AGE_MS);

  if (spotVenues.length >= 2) {
    let cheapest = spotVenues[0], richest = spotVenues[0];
    for (const v of spotVenues) {
      if (v.book.ask < cheapest.book.ask) cheapest = v;
      if (v.book.bid > richest.book.bid)  richest  = v;
    }
    if (cheapest.name !== richest.name) {
      const rawBps = ((richest.book.bid - cheapest.book.ask) / cheapest.book.ask) * 10_000;
      const netBps = rawBps - 4 * TAKER_FEE_BPS;

      if (netBps > stats.best_edge_seen_bps) {
        stats.best_edge_seen_bps = netBps;
        stats.best_edge_pair  = pair;
        stats.best_edge_route = cheapest.name + '->' + richest.name;
      }
      recordBucket(netBps);

      const threshold = pairThresholds[pair] || MIN_NET_EDGE_BPS;
      if (netBps >= threshold) {
        const fillable    = Math.min(cheapest.book.askSize, richest.book.bidSize);
        const signalAgeMs = now - Math.min(cheapest.book.ts, richest.book.ts);
        const key  = pair + '|' + cheapest.name + '|' + richest.name;
        const last = recentlyPosted.get(key);
        if (fillable >= MIN_FILLABLE_USD && signalAgeMs <= MAX_SIGNAL_AGE_MS && !(last && now - last < 5_000)) {
          recentlyPosted.set(key, now);
          stats.posted++;
          post({
            pair, asset: pair.split('-')[0],
            buy_exchange: cheapest.name, sell_exchange: richest.name,
            buy_price: cheapest.book.ask, sell_price: richest.book.bid,
            raw_spread_bps: rawBps, net_edge_bps: netBps,
            buy_depth_usd: cheapest.book.askSize, sell_depth_usd: richest.book.bidSize,
            fillable_size_usd: fillable, signal_age_ms: signalAgeMs,
            exchange_latency_ms: 0, confirmed_exchanges: spotVenues.length,
            signal_time: new Date().toISOString(),
            alert: netBps >= ALERT_EDGE_BPS,
            notes: 'cross-venue spot/spot (' + spotVenues.length + '-venue scan)',
          });
        } else if (last && now - last < 5_000) stats.rejected_dedupe++;
        else if (fillable < MIN_FILLABLE_USD) stats.rejected_fillable++;
        else stats.rejected_stale++;
      } else stats.rejected_edge++;
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
      const t = await res.text().catch(() => '');
      console.error('POST non-2xx ' + res.status + ' [' + payload.pair + ']: ' + t.slice(0, 200));
      return;
    }
    const body = await res.json();
    if (body.rejected) return; // net_edge <= 0, silently skip
    console.log('[' + payload.pair + '] ' + payload.buy_exchange + '->' + payload.sell_exchange +
      ' raw=' + payload.raw_spread_bps.toFixed(2) + ' net=' + payload.net_edge_bps.toFixed(2) +
      'bps fill=$' + Math.round(payload.fillable_size_usd) + ' -> ' + res.status + ' ' +
      (body.duplicate ? '(dup)' : body.signal_id || ''));
  } catch (e) {
    stats.post_errors++;
    console.error('POST failed:', e.message);
  }
}

async function postHeartbeat(freshBooks) {
  if (!HEARTBEAT_URL) return;
  try {
    await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify({
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
        venue_pair_checks: stats.venue_pair_checks, venue_no_book: stats.venue_no_book,
        venue_stale_book: stats.venue_stale_book, passed_edge_gate: stats.passed_edge_gate,
        passed_fillable_gate: stats.passed_fillable_gate, passed_stale_gate: stats.passed_stale_gate,
        passed_dedupe_gate: stats.passed_dedupe_gate, post_attempts: stats.post_attempts,
        post_errors: stats.post_errors, post_non_2xx: stats.post_non_2xx,
      }),
    });
  } catch (e) { console.error('heartbeat POST failed:', e.message); }
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
    if (!data?.pairs) return;
    for (const s of data.pairs) {
      if (s.recommended_min_bps && PAIRS.includes(s.pair)) {
        const next = Math.max(s.recommended_min_bps, MIN_NET_EDGE_BPS);
        const old  = pairThresholds[s.pair];
        pairThresholds[s.pair] = next;
        if (old !== next) console.log('[threshold] ' + s.pair + ': ' + old + ' -> ' + next + ' bps');
      }
    }
  } catch (e) { console.error('refreshThresholds:', e.message); }
}

setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [k, v] of recentlyPosted) if (v < cutoff) recentlyPosted.delete(k);
}, 30_000);

setInterval(refreshThresholds, 15 * 60_000);

setInterval(() => {
  const now   = Date.now();
  const conns = Object.entries(books).map(([v, pairs]) => {
    const freshCount = Object.values(pairs).filter(b => now - b.ts < MAX_SIGNAL_AGE_MS * 5).length;
    return v + ':' + freshCount + '/' + PAIRS.length;
  }).join(' ');
  const best = stats.best_edge_seen_bps > -Infinity
    ? 'best=' + stats.best_edge_seen_bps.toFixed(2) + 'bps ' + stats.best_edge_pair + ' ' + stats.best_edge_route
    : 'best=none';
  const dist   = 'dist[<5=' + stats.bucket_0_5 + ' 5-10=' + stats.bucket_5_10 + ' 10-15=' + stats.bucket_10_15 + ' 15-20=' + stats.bucket_15_20 + ' 20+=' + stats.bucket_20_plus + ']';
  const funnel = 'funnel[edge\\u2713=' + stats.passed_edge_gate + ' fill\\u2713=' + stats.passed_fillable_gate + ' age\\u2713=' + stats.passed_stale_gate + ' dedup\\u2713=' + stats.passed_dedupe_gate + ' post=' + stats.post_attempts + ' err=' + stats.post_errors + ' non2xx=' + stats.post_non_2xx + ']';
  console.log('[heartbeat] evals=' + stats.evaluations + ' posted=' + stats.posted +
    ' rej(edge=' + stats.rejected_edge + ' fill=' + stats.rejected_fillable +
    ' stale=' + stats.rejected_stale + ' dup=' + stats.rejected_dedupe + ') ' +
    best + ' ' + dist + ' ' + funnel + ' | ' + conns);
  postHeartbeat(conns);
  resetStats();
}, HEARTBEAT_MS);

console.log(
  'Arb BASIS-CARRY bot v3 (BIDIRECTIONAL + CROSS-VENUE CONFIRMATION) starting\\n' +
  '  pairs: ' + PAIRS.join(', ') + '\\n' +
  '  fee model: 4 legs x ' + TAKER_FEE_BPS + ' bps = ' + (4 * TAKER_FEE_BPS) + ' bps total\\n' +
  '  min net edge: ' + MIN_NET_EDGE_BPS + ' bps  alert: ' + ALERT_EDGE_BPS + ' bps\\n' +
  '  min fillable: $' + MIN_FILLABLE_USD + '  max signal age: ' + MAX_SIGNAL_AGE_MS + 'ms\\n' +
  '  binance: ' + (DISABLE_BINANCE ? 'DISABLED (DISABLE_BINANCE=true)' : 'enabled') + '\\n' +
  '  heartbeat: every ' + (HEARTBEAT_MS / 1000) + 's'
);

connectOKX();
connectBybitSpot();
connectBybitPerp();
if (!DISABLE_BINANCE) {
  connectBinanceSpot();
  connectBinancePerp();
} else {
  console.log('  [Binance] skipped — geo-blocked (US server). Set DISABLE_BINANCE=false to re-enable.');
}
refreshThresholds();
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