// Serves the current droplet bot.mjs as plain text.
// PUBLIC endpoint — no auth required.
// Usage from droplet:
//   curl -s https://polytrade.base44.app/functions/downloadBot -o /root/arb-ws-bot/bot.mjs && pm2 restart arb-bot

const BOT_SOURCE = `// Droplet WebSocket arbitrage bot — v4 (Bybit WS Orderbooks)
// Auto-downloaded from Base44. Start: node bot.mjs
// Uses Bybit WebSocket V5 orderbook.50 for real-time top-of-book data
// Fires signals only when net edge >= threshold AND fillable size >= min notional

import 'dotenv/config';
import { WebsocketClient } from 'bybit-api';

const INGEST_URL      = process.env.BASE44_INGEST_URL;
const HEARTBEAT_URL   = process.env.BASE44_HEARTBEAT_URL;
const TOKEN           = process.env.DROPLET_SECRET || process.env.BASE44_USER_TOKEN;

const SYMBOLS         = (process.env.SYMBOLS || 'BTCUSDT,ETHUSDT').split(',');
const MIN_NET_EDGE_BPS = Number(process.env.MIN_NET_EDGE_BPS || 3);
const MIN_NOTIONAL_USD = Number(process.env.MIN_NOTIONAL_USD || 15);
const TAKER_FEE_BPS_PER_LEG = 5; // Adjust for VIP tier
const TOTAL_FEE_BPS = TAKER_FEE_BPS_PER_LEG * 2; // 10 bps total for spot+perp
const ALERT_EDGE_BPS  = Number(process.env.ALERT_EDGE_BPS || 20);
const HEARTBEAT_MS    = Number(process.env.HEARTBEAT_MS || 60_000);

if (!INGEST_URL || !TOKEN) {
  console.error('Missing BASE44_INGEST_URL or DROPLET_SECRET');
  process.exit(1);
}

// Market state: { BTCUSDT: { spot: {askPrice, askVol, bidPrice, bidVol}, perp: {...} } }
const marketState = {};
const stats = { evaluations: 0, posted: 0, bestEdge: -Infinity, bestPair: '', bestRoute: '' };

// Initialize Bybit WebSocket Clients (V5)
const wsConfig = { market: 'v5' };
const wsSpot = new WebsocketClient({ ...wsConfig, testnet: false });
const wsPerp = new WebsocketClient({ ...wsConfig, testnet: false });

console.log(
  '🚀 Arb Bot v4 (WebSocket) starting\\n' +
  '  symbols: ' + SYMBOLS.join(', ') + '\\n' +
  '  min net edge: ' + MIN_NET_EDGE_BPS + ' bps\\n' +
  '  min notional: $' + MIN_NOTIONAL_USD + '\\n' +
  '  fees: ' + TOTAL_FEE_BPS + ' bps (spot+perp)\\n' +
  '  alert edge: ' + ALERT_EDGE_BPS + ' bps'
);

// Subscribe to orderbooks
SYMBOLS.forEach(symbol => {
  console.log('📡 Subscribing to ' + symbol + ' orderbooks...');
  wsSpot.subscribeV5('orderbook.50.' + symbol, 'spot');
  wsPerp.subscribeV5('orderbook.50.' + symbol, 'linear');
});

// Handle Spot Updates
wsSpot.on('update', (data) => {
  if (data.topic?.startsWith('orderbook') && data.data) {
    const symbol = data.topic.split('.')[2];
    if (SYMBOLS.includes(symbol)) {
      updateMarketState(symbol, 'spot', data.data);
      evaluateSignal(symbol);
    }
  }
});

// Handle Perp Updates
wsPerp.on('update', (data) => {
  if (data.topic?.startsWith('orderbook') && data.data) {
    const symbol = data.topic.split('.')[2];
    if (SYMBOLS.includes(symbol)) {
      updateMarketState(symbol, 'perp', data.data);
      evaluateSignal(symbol);
    }
  }
});

wsSpot.on('open', (topic) => console.log('✅ Spot WS connected:', topic));
wsPerp.on('open', (topic) => console.log('✅ Perp WS connected:', topic));
wsSpot.on('error', (e) => console.error('❌ Spot WS:', e.message));
wsPerp.on('error', (e) => console.error('❌ Perp WS:', e.message));

function updateMarketState(symbol, marketType, data) {
  if (!marketState[symbol]) {
    marketState[symbol] = {
      spot: { askPrice: 0, askVol: 0, bidPrice: 0, bidVol: 0 },
      perp: { askPrice: 0, askVol: 0, bidPrice: 0, bidVol: 0 }
    };
  }

  // Bybit sends 'a' (asks) and 'b' (bids): [ ["price", "size"], ... ]
  if (data.a && data.a.length > 0) {
    marketState[symbol][marketType].askPrice = parseFloat(data.a[0][0]);
    marketState[symbol][marketType].askVol = parseFloat(data.a[0][1]);
  }
  if (data.b && data.b.length > 0) {
    marketState[symbol][marketType].bidPrice = parseFloat(data.b[0][0]);
    marketState[symbol][marketType].bidVol = parseFloat(data.b[0][1]);
  }
}

function evaluateSignal(symbol) {
  const state = marketState[symbol];
  if (!state) return;

  const { spot, perp } = state;
  if (!spot.askPrice || !perp.bidPrice) return;

  stats.evaluations++;

  // Strategy: Long Spot @ ASK, Short Perp @ BID
  const grossSpreadBps = ((perp.bidPrice - spot.askPrice) / spot.askPrice) * 10000;
  const netEdgeBps = grossSpreadBps - TOTAL_FEE_BPS;

  // Volume check: calculate USD value at top of book
  const spotNotionalUsd = spot.askPrice * spot.askVol;
  const perpNotionalUsd = perp.bidPrice * perp.bidVol;
  const maxFillableUsd = Math.min(spotNotionalUsd, perpNotionalUsd);

  if (netEdgeBps > stats.bestEdge) {
    stats.bestEdge = netEdgeBps;
    stats.bestPair = symbol;
    stats.bestRoute = 'bybit-spot->bybit-perp';
  }

  // Fire signal only if edge AND size thresholds are met
  if (netEdgeBps >= MIN_NET_EDGE_BPS && maxFillableUsd >= MIN_NOTIONAL_USD) {
    const pair = symbol.replace('USDT', '-USDT');
    const signal = {
      signal_time: new Date().toISOString(),
      pair: pair,
      asset: pair.split('-')[0],
      buy_exchange: 'bybit-spot',
      sell_exchange: 'bybit-perp',
      buy_price: spot.askPrice,
      sell_price: perp.bidPrice,
      raw_spread_bps: grossSpreadBps,
      net_edge_bps: netEdgeBps,
      buy_depth_usd: spotNotionalUsd,
      sell_depth_usd: perpNotionalUsd,
      fillable_size_usd: maxFillableUsd,
      signal_age_ms: 0,
      exchange_latency_ms: 1,
      confirmed_exchanges: 2,
      alert: netEdgeBps >= ALERT_EDGE_BPS,
      notes: 'net:' + netEdgeBps.toFixed(1) + 'bps fill:$' + maxFillableUsd.toFixed(0),
    };

    post(signal);
    stats.posted++;
    console.log('🎯 [' + pair + '] Edge: ' + netEdgeBps.toFixed(2) + ' bps | Fill: $' + maxFillableUsd.toFixed(0));
  }
}

async function post(signal) {
  try {
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify(signal),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('❌ POST ' + res.status + ':', err.slice(0, 200));
      return;
    }
    const result = await res.json();
    console.log('✅ [' + signal.pair + '] → ' + (result.signal_id || 'posted'));
  } catch (e) {
    console.error('❌ POST failed:', e.message);
  }
}

async function postHeartbeat() {
  if (!HEARTBEAT_URL) return;
  const now = Date.now();
  const conns = Object.entries(marketState).map(([sym, data]) => {
    const spotFresh = data.spot.askPrice && (now - (data.spot.ts || 0)) < 10000 ? '1' : '0';
    const perpFresh = data.perp.bidPrice && (now - (data.perp.ts || 0)) < 10000 ? '1' : '0';
    return sym + '-spot:' + spotFresh + '/1 ' + sym + '-perp:' + perpFresh + '/1';
  }).join(' ');

  try {
    await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify({
        snapshot_time: new Date().toISOString(),
        evaluations: stats.evaluations,
        posted: stats.posted,
        best_edge_bps: stats.bestEdge > -Infinity ? stats.bestEdge : 0,
        best_edge_pair: stats.bestPair,
        best_edge_route: stats.bestRoute,
        fresh_books: conns,
      }),
    });
  } catch (e) {
    console.error('❌ Heartbeat failed:', e.message);
  }
}

// Heartbeat every 60 seconds
setInterval(() => {
  console.log('💓 evals=' + stats.evaluations + ' posted=' + stats.posted + ' best=' + stats.bestEdge.toFixed(1) + 'bps (' + stats.bestPair + ')');
  postHeartbeat();
  stats.evaluations = 0;
  stats.posted = 0;
}, HEARTBEAT_MS);
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