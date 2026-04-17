/**
 * Multi-Exchange Real-Time Price Feed
 *
 * Fetches live BTC/ETH prices from THREE independent public sources:
 *   1. Binance  — REST  (api.binance.com)
 *   2. Coinbase — REST  (api.coinbase.com)
 *   3. CoinGecko — REST (api.coingecko.com)  [fallback / tie-breaker]
 *
 * Cross-exchange spread IS the real arbitrage signal.
 * No random lag injection — if spread < threshold the scanner shows nothing.
 */

const REFRESH_MS = 6000; // fetch all exchanges every 6s

// ── State ────────────────────────────────────────────────────────────────────
let state = {
  btc: { binance: null, coinbase: null, coingecko: null, price: 97500, prev: 97500, change: 0 },
  eth: { binance: null, coinbase: null, coingecko: null, price: 3200,  prev: 3200,  change: 0 },
  live: false,
  lastUpdated: 0,
};

const subscribers = new Set();
let fetchInterval = null;

// ── Exchange fetchers ─────────────────────────────────────────────────────────
async function fetchBinance() {
  const res = await fetch(
    'https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT"]',
    { cache: 'no-store', signal: AbortSignal.timeout(4000) }
  );
  if (!res.ok) throw new Error('Binance fail');
  const data = await res.json();
  const btc = parseFloat(data.find(d => d.symbol === 'BTCUSDT')?.price);
  const eth = parseFloat(data.find(d => d.symbol === 'ETHUSDT')?.price);
  return { btc, eth };
}

async function fetchCoinbase() {
  const [btcRes, ethRes] = await Promise.all([
    fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { cache: 'no-store', signal: AbortSignal.timeout(4000) }),
    fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', { cache: 'no-store', signal: AbortSignal.timeout(4000) }),
  ]);
  if (!btcRes.ok || !ethRes.ok) throw new Error('Coinbase fail');
  const [btcData, ethData] = await Promise.all([btcRes.json(), ethRes.json()]);
  return {
    btc: parseFloat(btcData.data.amount),
    eth: parseFloat(ethData.data.amount),
  };
}

async function fetchCoinGecko() {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd',
    { cache: 'no-store', signal: AbortSignal.timeout(5000) }
  );
  if (!res.ok) throw new Error('CoinGecko fail');
  const data = await res.json();
  return { btc: data.bitcoin.usd, eth: data.ethereum.usd };
}

// ── Main fetch + update ───────────────────────────────────────────────────────
async function fetchAllExchanges() {
  const results = await Promise.allSettled([fetchBinance(), fetchCoinbase(), fetchCoinGecko()]);

  const [binance, coinbase, coingecko] = results.map(r => r.status === 'fulfilled' ? r.value : null);

  let gotAny = false;

  for (const asset of ['btc', 'eth']) {
    const prices = [
      binance?.[asset],
      coinbase?.[asset],
      coingecko?.[asset],
    ].filter(p => p && isFinite(p) && p > 0);

    if (prices.length === 0) continue;
    gotAny = true;

    // Mid-price = average of all available exchanges
    const mid = prices.reduce((a, b) => a + b, 0) / prices.length;

    state[asset] = {
      binance:   binance?.[asset]   ?? null,
      coinbase:  coinbase?.[asset]  ?? null,
      coingecko: coingecko?.[asset] ?? null,
      prev:      state[asset].price,
      price:     mid,
      change:    state[asset].price > 0 ? ((mid - state[asset].price) / state[asset].price) * 100 : 0,
    };
  }

  if (gotAny) {
    state.live = true;
    state.lastUpdated = Date.now();
    broadcast();
  }
}

function broadcast() {
  const payload = {
    btc: { ...state.btc, live: state.live },
    eth: { ...state.eth, live: state.live },
    live: state.live,
    ts: state.lastUpdated,
    // Cross-exchange spread (the real arb signal)
    spread: {
      btc: getSpread('btc'),
      eth: getSpread('eth'),
    },
  };
  subscribers.forEach(fn => fn(payload));
}

function getSpread(asset) {
  const { binance, coinbase, coingecko } = state[asset];
  const prices = [binance, coinbase, coingecko].filter(p => p && isFinite(p));
  if (prices.length < 2) return 0;
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  return ((max - min) / min) * 100; // spread in %
}

export function startPriceSimulator(onUpdate) {
  subscribers.add(onUpdate);
  if (fetchInterval) return;
  fetchAllExchanges();
  fetchInterval = setInterval(fetchAllExchanges, REFRESH_MS);
}

export function stopPriceSimulator(onUpdate) {
  subscribers.delete(onUpdate);
  if (subscribers.size === 0 && fetchInterval) {
    clearInterval(fetchInterval);
    fetchInterval = null;
  }
}

export function getCurrentPrices() {
  return { ...state };
}

// ── Polymarket CLOB contract builder ─────────────────────────────────────────
// Uses REAL cross-exchange spread as the lag proxy instead of random noise.
// The "Polymarket price" is the slower exchange; "CEX implied" is the faster one.

const CONTRACTS = [
  { id: 'btc-5min-up',    asset: 'BTC', type: '5min_up',    title: 'BTC up in 5 min?'    },
  { id: 'btc-5min-down',  asset: 'BTC', type: '5min_down',  title: 'BTC down in 5 min?'  },
  { id: 'btc-15min-up',   asset: 'BTC', type: '15min_up',   title: 'BTC up in 15 min?'   },
  { id: 'btc-15min-down', asset: 'BTC', type: '15min_down', title: 'BTC down in 15 min?' },
  { id: 'eth-5min-up',    asset: 'ETH', type: '5min_up',    title: 'ETH up in 5 min?'    },
  { id: 'eth-5min-down',  asset: 'ETH', type: '5min_down',  title: 'ETH down in 5 min?'  },
  { id: 'eth-15min-up',   asset: 'ETH', type: '15min_up',   title: 'ETH up in 15 min?'   },
  { id: 'eth-15min-down', asset: 'ETH', type: '15min_down', title: 'ETH down in 15 min?' },
];

export function getPolymarketContracts(btcP, ethP, btcPrev, ethPrev) {
  const btcSpread = getSpread('btc');  // real cross-exchange spread %
  const ethSpread = getSpread('eth');

  // Binance leads, Coinbase lags (common in real markets)
  const btcFast = state.btc.binance  || btcP;
  const btcSlow = state.btc.coinbase || btcP;
  const ethFast = state.eth.binance  || ethP;
  const ethSlow = state.eth.coinbase || ethP;

  return CONTRACTS.map(c => {
    const isbtc = c.asset === 'BTC';
    const fastPrice = isbtc ? btcFast : ethFast;
    const slowPrice = isbtc ? btcSlow : ethSlow;
    const curr      = isbtc ? btcP    : ethP;
    const prev      = isbtc ? btcPrev : ethPrev;
    const spread    = isbtc ? btcSpread : ethSpread;
    const vol       = isbtc ? 0.012 : 0.018;

    // CEX-implied probability: derived from FAST exchange momentum
    const pctMove = prev > 0 ? (curr - prev) / prev : 0;
    const momentum = pctMove / vol;
    const probUp = 1 / (1 + Math.exp(-momentum * 2));
    const cexP = c.type.includes('up') ? probUp : 1 - probUp;

    // Polymarket "stale" price: based on SLOW exchange (real lag)
    const slowMove = fastPrice > 0 ? (slowPrice - fastPrice) / fastPrice : 0;
    const slowMom  = slowMove / vol;
    const slowProbUp = 1 / (1 + Math.exp(-slowMom * 2));
    const polyP = Math.max(0.02, Math.min(0.98, c.type.includes('up') ? slowProbUp : 1 - slowProbUp));

    const lagPct = Math.abs(cexP - polyP) * 100;

    return {
      ...c,
      polymarket_price: polyP,
      cex_implied_prob: cexP,
      lag_pct: lagPct,
      // Extra exchange-level context for the monitor table
      fast_exchange: isbtc ? 'Binance' : 'Binance',
      slow_exchange: isbtc ? 'Coinbase' : 'Coinbase',
      spread_pct: spread,
      fast_price: fastPrice,
      slow_price: slowPrice,
    };
  });
}

export { CONTRACTS };