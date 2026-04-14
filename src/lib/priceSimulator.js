// Simulates Binance WebSocket BTC/ETH prices for paper trading
// In production: connect to wss://stream.binance.com:9443/ws/btcusdt@trade

const BTC_BASE = 97500;
const ETH_BASE = 3200;

let btcPrice = BTC_BASE;
let ethPrice = ETH_BASE;
let btcPrev = BTC_BASE;
let ethPrev = ETH_BASE;

const subscribers = new Set();

function randomWalk(price, volatility = 0.0008) {
  const change = price * volatility * (Math.random() - 0.48); // slight upward bias
  return Math.max(price * 0.95, price + change);
}

let interval = null;

export function startPriceSimulator(onUpdate) {
  if (interval) return;
  subscribers.add(onUpdate);

  if (interval) return;
  interval = setInterval(() => {
    btcPrev = btcPrice;
    ethPrev = ethPrice;
    btcPrice = randomWalk(btcPrice, 0.0012);
    ethPrice = randomWalk(ethPrice, 0.0015);

    const update = {
      btc: { price: btcPrice, prev: btcPrev, change: ((btcPrice - btcPrev) / btcPrev) * 100 },
      eth: { price: ethPrice, prev: ethPrev, change: ((ethPrice - ethPrev) / ethPrev) * 100 },
      ts: Date.now(),
    };

    subscribers.forEach(fn => fn(update));
  }, 1500); // update every 1.5s
}

export function stopPriceSimulator(onUpdate) {
  subscribers.delete(onUpdate);
  if (subscribers.size === 0 && interval) {
    clearInterval(interval);
    interval = null;
  }
}

export function getCurrentPrices() {
  return { btc: btcPrice, eth: ethPrice, btcPrev, ethPrev };
}

// Simulated Polymarket CLOB order book prices for BTC/ETH contracts
const CONTRACTS = [
  { id: 'btc-5min-up', asset: 'BTC', type: '5min_up', title: 'BTC up in 5 min?' },
  { id: 'btc-5min-down', asset: 'BTC', type: '5min_down', title: 'BTC down in 5 min?' },
  { id: 'btc-15min-up', asset: 'BTC', type: '15min_up', title: 'BTC up in 15 min?' },
  { id: 'btc-15min-down', asset: 'BTC', type: '15min_down', title: 'BTC down in 15 min?' },
  { id: 'eth-5min-up', asset: 'ETH', type: '5min_up', title: 'ETH up in 5 min?' },
  { id: 'eth-5min-down', asset: 'ETH', type: '5min_down', title: 'ETH down in 5 min?' },
  { id: 'eth-15min-up', asset: 'ETH', type: '15min_up', title: 'ETH up in 15 min?' },
  { id: 'eth-15min-down', asset: 'ETH', type: '15min_down', title: 'ETH down in 15 min?' },
];

// Polymarket prices lag the true CEX-implied probability (that's the arb!)
const polymarkLag = {};
CONTRACTS.forEach(c => { polymarkLag[c.id] = (Math.random() - 0.5) * 0.06; });

export function getPolymarketContracts(btcP, ethP, btcPr, ethPr) {
  return CONTRACTS.map(c => {
    const asset = c.asset;
    const curr = asset === 'BTC' ? btcP : ethP;
    const prev = asset === 'BTC' ? btcPr : ethPr;
    const pctMove = (curr - prev) / prev;

    // True CEX-implied probability
    const vol = asset === 'BTC' ? 0.012 : 0.018;
    const momentum = pctMove / vol;
    const trueProbUp = 1 / (1 + Math.exp(-momentum * 2));
    const trueProb = c.type.includes('up') ? trueProbUp : 1 - trueProbUp;

    // Polymarket lags by a random amount (simulating real latency)
    polymarkLag[c.id] += (Math.random() - 0.5) * 0.005;
    polymarkLag[c.id] = Math.max(-0.15, Math.min(0.15, polymarkLag[c.id]));
    const polyPrice = Math.max(0.02, Math.min(0.98, trueProb + polymarkLag[c.id]));

    const lagPct = Math.abs(trueProb - polyPrice) * 100;

    return {
      ...c,
      polymarket_price: polyPrice,
      cex_implied_prob: trueProb,
      lag_pct: lagPct,
    };
  });
}

export { CONTRACTS };