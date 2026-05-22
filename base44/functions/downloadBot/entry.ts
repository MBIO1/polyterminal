// Serves the v4 WebSocket bot code
// Run on droplet: curl -s https://polytrade.base44.app/functions/downloadBot -o /root/arb-ws-bot/bot.mjs && pm2 restart arb-bot --update-env

const BOT_SOURCE = `import 'dotenv/config';
import { WebsocketClient } from 'bybit-api';

const INGEST_URL = process.env.BASE44_INGEST_URL;
const HEARTBEAT_URL = process.env.BASE44_HEARTBEAT_URL;
const TOKEN = process.env.DROPLET_SECRET || process.env.BASE44_USER_TOKEN;
const SYMBOLS = (process.env.SYMBOLS || 'BTCUSDT,ETHUSDT').split(',');
const MIN_NET_EDGE_BPS = Number(process.env.MIN_NET_EDGE_BPS || 3);
const MIN_NOTIONAL_USD = Number(process.env.MIN_NOTIONAL_USD || 15);
const TAKER_FEE_BPS = 5;
const TOTAL_FEE_BPS = TAKER_FEE_BPS * 2;
const ALERT_EDGE_BPS = Number(process.env.ALERT_EDGE_BPS || 20);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 60000);

if (!INGEST_URL || !TOKEN) {
  console.error('Missing BASE44_INGEST_URL or DROPLET_SECRET');
  process.exit(1);
}

const marketState = {};
const stats = { evaluations: 0, posted: 0, bestEdge: -Infinity, bestPair: '', bestRoute: '' };

let wsSpot = null;
let wsPerp = null;

function createWebSocketClients(symbol) {
  console.log('🔌 Connecting to Bybit V5 WebSockets for ' + symbol + '...');

  const wsConfig = {
    market: 'v5',
    testnet: false,
    pingInterval: 20000,
    reconnectTimeout: 5000,
    logger: {
      debug: (msg) => console.debug('DEBUG:', msg),
      info: (msg) => console.info('INFO:', msg),
      warn: (msg) => console.warn('WARN:', msg),
      error: (msg) => console.error('ERROR:', msg),
    },
  };

  wsSpot = new WebsocketClient(wsConfig);
  wsPerp = new WebsocketClient(wsConfig);

  SYMBOLS.forEach(sym => {
    console.log('📡 Subscribing to ' + sym + ' orderbooks...');
    wsSpot.subscribeV5('orderbook.50.' + sym, 'spot');
    wsPerp.subscribeV5('orderbook.50.' + sym, 'linear');
  });

  wsSpot.on('update', (data) => {
    if (data.topic && data.topic.startsWith('orderbook') && data.data) {
      const parts = data.topic.split('.');
      const sym = parts[parts.length - 1];
      if (SYMBOLS.includes(sym)) {
        updateMarketState(sym, 'spot', data.data);
        evaluateSignal(sym);
      }
    }
  });

  wsPerp.on('update', (data) => {
    if (data.topic && data.topic.startsWith('orderbook') && data.data) {
      const parts = data.topic.split('.');
      const sym = parts[parts.length - 1];
      if (SYMBOLS.includes(sym)) {
        updateMarketState(sym, 'perp', data.data);
        evaluateSignal(sym);
      }
    }
  });

  wsSpot.on('open', (topic) => console.log('✅ Spot WS connected:', topic));
  wsPerp.on('open', (topic) => console.log('✅ Perp WS connected:', topic));
  wsSpot.on('error', (e) => console.error('❌ Spot WS:', e.message));
  wsPerp.on('error', (e) => console.error('❌ Perp WS:', e.message));
}

console.log('🚀 Arb Bot v4 (WebSocket) starting');
console.log('  symbols:', SYMBOLS.join(', '));
console.log('  min net edge:', MIN_NET_EDGE_BPS, 'bps');
console.log('  min notional: $' + MIN_NOTIONAL_USD);
console.log('  fees:', TOTAL_FEE_BPS, 'bps');

createWebSocketClients(SYMBOLS[0]);

function updateMarketState(symbol, marketType, data) {
  if (!marketState[symbol]) {
    marketState[symbol] = {
      spot: { askPrice: 0, askVol: 0, bidPrice: 0, bidVol: 0 },
      perp: { askPrice: 0, askVol: 0, bidPrice: 0, bidVol: 0 }
    };
  }
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
  const grossSpreadBps = ((perp.bidPrice - spot.askPrice) / spot.askPrice) * 10000;
  const netEdgeBps = grossSpreadBps - TOTAL_FEE_BPS;
  const spotNotionalUsd = spot.askPrice * spot.askVol;
  const perpNotionalUsd = perp.bidPrice * perp.bidVol;
  const maxFillableUsd = Math.min(spotNotionalUsd, perpNotionalUsd);

  if (netEdgeBps > stats.bestEdge) {
    stats.bestEdge = netEdgeBps;
    stats.bestPair = symbol;
    stats.bestRoute = 'bybit-spot->bybit-perp';
  }

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
    console.log('🎯 [' + pair + '] Edge:', netEdgeBps.toFixed(2), 'bps | Fill: $' + maxFillableUsd.toFixed(0));
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
    const spotFresh = data.spot.askPrice ? '1' : '0';
    const perpFresh = data.perp.bidPrice ? '1' : '0';
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