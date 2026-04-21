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
const TOKEN = process.env.BASE44_USER_TOKEN;
const PAIRS = (process.env.PAIRS || 'BTC-USDT,ETH-USDT,SOL-USDT,AVAX-USDT,LINK-USDT,DOGE-USDT,ADA-USDT').split(',');
const MIN_NET_EDGE_BPS = Number(process.env.MIN_NET_EDGE_BPS || 5);
const MAX_SIGNAL_AGE_MS = Number(process.env.MAX_SIGNAL_AGE_MS || 1000);
const MIN_FILLABLE_USD = Number(process.env.MIN_FILLABLE_USD || 2000);
const ALERT_EDGE_BPS = Number(process.env.ALERT_EDGE_BPS || 15);
const TAKER_FEE_BPS = Number(process.env.TAKER_FEE_BPS || 5); // ~5 bps per leg on OKX/Bybit perp
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 60000);

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
};
function resetStats() {
  for (const k of Object.keys(stats)) {
    if (typeof stats[k] === 'number') stats[k] = k === 'best_edge_seen_bps' ? -Infinity : 0;
    else stats[k] = '';
  }
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
function connectBybitSpot() {
  const ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');
  ws.on('open', () => ws.send(JSON.stringify({ op: 'subscribe', args: PAIRS.map(p => 'tickers.' + p.replace('-', '')) })));
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (!msg.topic || !msg.data) return;
    const sym = msg.topic.split('.')[1];
    const pair = PAIRS.find(p => p.replace('-', '') === sym);
    if (!pair) return;
    const d = msg.data;
    books['Bybit-spot'][pair] = {
      bid: Number(d.bid1Price), ask: Number(d.ask1Price),
      bidSize: Number(d.bid1Size) * Number(d.bid1Price),
      askSize: Number(d.ask1Size) * Number(d.ask1Price),
      ts: Date.now(),
    };
    evaluate(pair);
  });
  ws.on('close', () => setTimeout(connectBybitSpot, 2000));
  ws.on('error', e => console.error('Bybit spot WS:', e.message));
}

// Bybit linear perp (USDT-margined)
function connectBybitPerp() {
  const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
  ws.on('open', () => ws.send(JSON.stringify({ op: 'subscribe', args: PAIRS.map(p => 'tickers.' + p.replace('-', '')) })));
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (!msg.topic || !msg.data) return;
    const sym = msg.topic.split('.')[1];
    const pair = PAIRS.find(p => p.replace('-', '') === sym);
    if (!pair) return;
    const d = msg.data;
    // Bybit linear ticker sends snapshot+delta — fields may be missing/empty on deltas
    const existing = books['Bybit-perp'][pair] || {};
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
    books['Bybit-perp'][pair] = {
      bid, ask,
      bidSize: bidSzQty * bid,
      askSize: askSzQty * ask,
      ts: Date.now(),
    };
    evaluate(pair);
  });
  ws.on('close', () => setTimeout(connectBybitPerp, 2000));
  ws.on('error', e => console.error('Bybit perp WS:', e.message));
}

// Basis evaluation: for each venue (OKX, Bybit), compare spot vs perp.
// Strategy: if perp > spot by enough → short perp / long spot (buy spot, sell perp).
//           if spot > perp by enough → long perp / short spot (but short spot is hard, skip for now).
function evaluate(pair) {
  const now = Date.now();
  stats.evaluations++;
  const venues = ['OKX', 'Bybit'];
  for (const venue of venues) {
    const spot = books[venue + '-spot'][pair];
    const perp = books[venue + '-perp'][pair];
    if (!spot || !perp) continue;
    if (now - spot.ts > MAX_SIGNAL_AGE_MS || now - perp.ts > MAX_SIGNAL_AGE_MS) continue;

    // Buy spot at spot.ask, sell perp at perp.bid
    const rawSpreadBps = ((perp.bid - spot.ask) / spot.ask) * 10000;
    const netEdgeBps = rawSpreadBps - 2 * TAKER_FEE_BPS;

    if (netEdgeBps > stats.best_edge_seen_bps) {
      stats.best_edge_seen_bps = netEdgeBps;
      stats.best_edge_pair = pair;
      stats.best_edge_route = venue + '-spot->' + venue + '-perp';
    }

    const threshold = pairThresholds[pair] || MIN_NET_EDGE_BPS;
    if (netEdgeBps < threshold) { stats.rejected_edge++; continue; }

    const fillable = Math.min(spot.askSize, perp.bidSize);
    if (fillable < MIN_FILLABLE_USD) { stats.rejected_fillable++; continue; }

    const signalAgeMs = now - Math.min(spot.ts, perp.ts);
    if (signalAgeMs > MAX_SIGNAL_AGE_MS) { stats.rejected_stale++; continue; }

    const key = pair + '|' + venue + '-spot|' + venue + '-perp';
    const last = recentlyPosted.get(key);
    if (last && now - last < 20000) { stats.rejected_dedupe++; continue; }
    recentlyPosted.set(key, now);
    stats.posted++;

    post({
      pair, asset: pair.split('-')[0],
      buy_exchange: venue + '-spot', sell_exchange: venue + '-perp',
      buy_price: spot.ask, sell_price: perp.bid,
      raw_spread_bps: rawSpreadBps, net_edge_bps: netEdgeBps,
      buy_depth_usd: spot.askSize, sell_depth_usd: perp.bidSize,
      fillable_size_usd: fillable, signal_age_ms: signalAgeMs,
      exchange_latency_ms: 0, confirmed_exchanges: 2,
      signal_time: new Date().toISOString(),
      alert: netEdgeBps >= ALERT_EDGE_BPS,
      notes: 'basis carry: long spot / short perp',
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
        pairThresholds[s.pair] = s.recommended_min_bps;
        if (old !== s.recommended_min_bps) console.log('[threshold] ' + s.pair + ': ' + old + ' -> ' + s.recommended_min_bps + ' bps');
      }
    }
  } catch (e) { console.error('refreshThresholds:', e.message); }
}

setInterval(() => { const cutoff = Date.now() - 60000; for (const [k, v] of recentlyPosted) if (v < cutoff) recentlyPosted.delete(k); }, 30000);
setInterval(refreshThresholds, 15 * 60000);
setInterval(() => {
  const now = Date.now();
  const conns = Object.entries(books).map(([v, pairs]) => {
    const freshCount = Object.values(pairs).filter(b => now - b.ts < MAX_SIGNAL_AGE_MS * 5).length;
    return v + ':' + freshCount + '/' + PAIRS.length;
  }).join(' ');
  const best = stats.best_edge_seen_bps > -Infinity
    ? 'best=' + stats.best_edge_seen_bps.toFixed(2) + 'bps ' + stats.best_edge_pair + ' ' + stats.best_edge_route
    : 'best=none';
  console.log('[heartbeat] evals=' + stats.evaluations + ' posted=' + stats.posted + ' rej(edge=' + stats.rejected_edge + ' fill=' + stats.rejected_fillable + ' stale=' + stats.rejected_stale + ' dup=' + stats.rejected_dedupe + ') ' + best + ' | ' + conns);
  resetStats();
}, HEARTBEAT_MS);

console.log('Arb BASIS-CARRY bot starting - pairs: ' + PAIRS.join(', ') + ' - min edge: ' + MIN_NET_EDGE_BPS + 'bps - min fillable: $' + MIN_FILLABLE_USD + ' - max age: ' + MAX_SIGNAL_AGE_MS + 'ms');
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