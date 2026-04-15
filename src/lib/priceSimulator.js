// Real-time BTC/ETH prices from CoinGecko (free, no API key)
// Falls back to simulated random walk if fetch fails

let btcPrice = 97500;
let ethPrice = 3200;
let btcPrev = 97500;
let ethPrev = 3200;
let lastFetchOk = false;

const subscribers = new Set();
let interval = null;
let fetchInterval = null;

// ── Fetch real prices from CoinGecko ────────────────────────────────────────
async function fetchRealPrices() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true',
      { cache: 'no-store' }
    );
    if (!res.ok) throw new Error('CoinGecko non-200');
    const data = await res.json();

    btcPrev = btcPrice;
    ethPrev = ethPrice;
    btcPrice = data.bitcoin.usd;
    ethPrice = data.ethereum.usd;
    lastFetchOk = true;

    broadcast();
  } catch {
    // silently fall back to random-walk tick
    lastFetchOk = false;
  }
}

// ── Random-walk tick (runs every 1.5s to keep the UI alive between API calls) ─
function randomWalk(price, volatility = 0.0008) {
  const change = price * volatility * (Math.random() - 0.48);
  return Math.max(price * 0.95, price + change);
}

function tickLocal() {
  if (lastFetchOk) {
    // micro-noise around real price so the ticker still feels alive
    btcPrev = btcPrice;
    ethPrev = ethPrice;
    btcPrice = randomWalk(btcPrice, 0.00015);
    ethPrice = randomWalk(ethPrice, 0.00018);
  } else {
    btcPrev = btcPrice;
    ethPrev = ethPrice;
    btcPrice = randomWalk(btcPrice, 0.0012);
    ethPrice = randomWalk(ethPrice, 0.0015);
  }
  broadcast();
}

function broadcast() {
  const update = {
    btc: { price: btcPrice, prev: btcPrev, change: ((btcPrice - btcPrev) / btcPrev) * 100 },
    eth: { price: ethPrice, prev: ethPrev, change: ((ethPrice - ethPrev) / ethPrev) * 100 },
    ts: Date.now(),
    live: lastFetchOk,
  };
  subscribers.forEach(fn => fn(update));
}

export function startPriceSimulator(onUpdate) {
  subscribers.add(onUpdate);
  if (interval) return; // already running

  // Fetch real prices immediately and then every 15s
  fetchRealPrices();
  fetchInterval = setInterval(fetchRealPrices, 15000);

  // Local tick every 1.5s for smooth UI
  interval = setInterval(tickLocal, 1500);
}

export function stopPriceSimulator(onUpdate) {
  subscribers.delete(onUpdate);
  if (subscribers.size === 0) {
    if (interval) { clearInterval(interval); interval = null; }
    if (fetchInterval) { clearInterval(fetchInterval); fetchInterval = null; }
  }
}

export function getCurrentPrices() {
  return { btc: btcPrice, eth: ethPrice, btcPrev, ethPrev, live: lastFetchOk };
}

// ── Simulated Polymarket CLOB contracts ─────────────────────────────────────
const CONTRACTS = [
  { id: 'btc-5min-up',   asset: 'BTC', type: '5min_up',   title: 'BTC up in 5 min?'   },
  { id: 'btc-5min-down', asset: 'BTC', type: '5min_down', title: 'BTC down in 5 min?' },
  { id: 'btc-15min-up',  asset: 'BTC', type: '15min_up',  title: 'BTC up in 15 min?'  },
  { id: 'btc-15min-down',asset: 'BTC', type: '15min_down',title: 'BTC down in 15 min?'},
  { id: 'eth-5min-up',   asset: 'ETH', type: '5min_up',   title: 'ETH up in 5 min?'   },
  { id: 'eth-5min-down', asset: 'ETH', type: '5min_down', title: 'ETH down in 5 min?' },
  { id: 'eth-15min-up',  asset: 'ETH', type: '15min_up',  title: 'ETH up in 15 min?'  },
  { id: 'eth-15min-down',asset: 'ETH', type: '15min_down',title: 'ETH down in 15 min?'},
];

const polymarkLag = {};
CONTRACTS.forEach(c => { polymarkLag[c.id] = (Math.random() - 0.5) * 0.06; });

export function getPolymarketContracts(btcP, ethP, btcPr, ethPr) {
  return CONTRACTS.map(c => {
    const asset = c.asset;
    const curr = asset === 'BTC' ? btcP : ethP;
    const prev = asset === 'BTC' ? btcPr : ethPr;
    const pctMove = prev > 0 ? (curr - prev) / prev : 0;

    const vol = asset === 'BTC' ? 0.012 : 0.018;
    const momentum = pctMove / vol;
    const trueProbUp = 1 / (1 + Math.exp(-momentum * 2));
    const trueProb = c.type.includes('up') ? trueProbUp : 1 - trueProbUp;

    polymarkLag[c.id] += (Math.random() - 0.5) * 0.005;
    polymarkLag[c.id] = Math.max(-0.15, Math.min(0.15, polymarkLag[c.id]));
    const polyPrice = Math.max(0.02, Math.min(0.98, trueProb + polymarkLag[c.id]));
    const lagPct = Math.abs(trueProb - polyPrice) * 100;

    return { ...c, polymarket_price: polyPrice, cex_implied_prob: trueProb, lag_pct: lagPct };
  });
}

export { CONTRACTS };