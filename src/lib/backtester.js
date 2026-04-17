// Backtesting engine — simulates 200 trades over 3 months
// Uses real BTC/ETH price history proxied via CoinGecko market_chart API
// Falls back to synthetic price series if fetch fails

const THREE_MONTHS_SECS = 90 * 24 * 3600;

// ── Fetch 90-day hourly close prices from CoinGecko ─────────────────────────
async function fetchPriceHistory(coinId) {
  const url =
    `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart` +
    `?vs_currency=usd&days=90&interval=hourly`;
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error('CoinGecko history fail');
  const data = await res.json();
  // prices: [[timestamp_ms, price], ...]
  return data.prices.map(([ts, p]) => ({ ts, price: p }));
}

// ── Synthetic fallback: geometric Brownian motion ────────────────────────────
function syntheticHistory(basePrice, drift = 0.0001, sigma = 0.012, n = 2160) {
  const out = [];
  let p = basePrice;
  const now = Date.now();
  for (let i = n; i >= 0; i--) {
    p = p * Math.exp(drift + sigma * (Math.random() - 0.5));
    out.push({ ts: now - i * 3600_000, price: p });
  }
  return out;
}

// ── Compute CEX-implied probability for a contract ────────────────────────────
function cexProb(contractType, curr, prev, vol) {
  const pctMove = prev > 0 ? (curr - prev) / prev : 0;
  const momentum = pctMove / vol;
  const probUp = 1 / (1 + Math.exp(-momentum * 2));
  return contractType.includes('up') ? probUp : 1 - probUp;
}

// ── Run one back-test scenario ────────────────────────────────────────────────
function runScenario(prices, contractType, asset, lagThresh, edgeThresh, confThresh, kellyFrac = 0.5, capital = 1000) {
  const vol = asset === 'BTC' ? 0.012 : 0.018;
  let balance = capital;
  const trades = [];

  for (let i = 1; i < prices.length - 1 && trades.length < 200; i++) {
    const curr = prices[i].price;
    const prev = prices[i - 1].price;
    const cexP = cexProb(contractType, curr, prev, vol);

    // Simulate Polymarket lag
    const lag = (Math.random() - 0.5) * 0.15;
    const polyP = Math.max(0.02, Math.min(0.98, cexP + lag));
    const lagPct = Math.abs(cexP - polyP) * 100;
    const edge = lagPct;
    const confidence = Math.min(99, 60 + lagPct * 3);

    if (lagPct < lagThresh || edge < edgeThresh || confidence < confThresh) continue;

    // Half-Kelly sizing
    const b = (1 - polyP) / polyP;
    const p = polyP + edge / 100;
    const fullK = (b * p - (1 - p)) / b;
    const size = Math.min(Math.max(1, (fullK * kellyFrac * balance)), balance * 0.08);

    // Outcome: does price actually go up/down in next candle?
    const nextPrice = prices[i + 1].price;
    const actuallyWent = contractType.includes('up') ? nextPrice > curr : nextPrice < curr;

    const pnl = actuallyWent ? size * ((1 - polyP) / polyP) : -size;
    balance = Math.max(0, balance + pnl);

    trades.push({
      i, lagPct, edge, confidence, polyP, cexP,
      size, pnl, balance, win: actuallyWent,
    });

    if (balance <= 0) break;
  }

  const wins = trades.filter(t => t.win).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const totalPnl = balance - capital;
  const maxDD = computeMaxDrawdown(trades);
  const profitFactor = computeProfitFactor(trades);

  return { trades, winRate, totalPnl, maxDD, profitFactor, finalBalance: balance };
}

function computeMaxDrawdown(trades) {
  let peak = 1000;
  let maxDD = 0;
  trades.forEach(t => {
    if (t.balance > peak) peak = t.balance;
    const dd = peak > 0 ? ((peak - t.balance) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  });
  return maxDD;
}

function computeProfitFactor(trades) {
  const gross = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const loss = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  return loss > 0 ? gross / loss : gross > 0 ? 99 : 0;
}

// ── Quick search (3×3 = 9 combos, browser-safe) ──────────────────────────────
function quickSearch(prices, contractType, asset) {
  const lagOptions  = [3, 5, 7];
  const edgeOptions = [4, 7, 10];
  const conf        = 85; // fixed to keep combos low

  let best = null;
  for (const lag of lagOptions) {
    for (const edge of edgeOptions) {
      const r = runScenario(prices, contractType, asset, lag, edge, conf);
      if (r.trades.length < 5) continue;
      const score = r.winRate * 0.4 + r.profitFactor * 10 - r.maxDD * 0.5;
      if (!best || score > best.score) {
        best = { lag, edge, conf, score, ...r };
      }
    }
  }
  return best;
}

// ── Full grid search (only used in non-params path) ──────────────────────────
function gridSearch(prices, contractType, asset) {
  const lagOptions   = [3, 5, 7];
  const edgeOptions  = [4, 7, 10];
  const confOptions  = [80, 85, 90];

  let best = null;
  for (const lag of lagOptions) {
    for (const edge of edgeOptions) {
      for (const conf of confOptions) {
        const r = runScenario(prices, contractType, asset, lag, edge, conf);
        if (r.trades.length < 5) continue;
        const score = r.winRate * 0.4 + r.profitFactor * 10 - r.maxDD * 0.5;
        if (!best || score > best.score) {
          best = { lag, edge, conf, score, ...r };
        }
      }
    }
  }
  return best;
}

// ── Main entry point ──────────────────────────────────────────────────────────
// params (optional): { lagThresh, edgeThresh, confThresh, kellyFrac, capital, contractType }
// If params provided → run single fixed scenario. Otherwise → run grid search.
export async function runBacktest(onProgress, params = null) {
  onProgress?.('Fetching price history from CoinGecko…', 5);

  let btcPrices, ethPrices;
  let dataSource = 'CoinGecko (real)';
  try {
    [btcPrices, ethPrices] = await Promise.all([
      fetchPriceHistory('bitcoin'),
      fetchPriceHistory('ethereum'),
    ]);
    onProgress?.('Real price history loaded ✓', 20);
  } catch {
    onProgress?.('API unavailable — using synthetic GBM series…', 20);
    btcPrices = syntheticHistory(97500, 0.00005, 0.012);
    ethPrices = syntheticHistory(3200, 0.00006, 0.018);
    dataSource = 'Synthetic GBM';
  }

  // ── Fixed-param single scenario ───────────────────────────────────────────
  if (params) {
    const { lagThresh = 3, edgeThresh = 5, confThresh = 85, kellyFrac = 0.5, capital = 1000, contractType = '5min_up' } = params;
    const asset = 'BTC';
    const prices = contractType.includes('eth') ? ethPrices : btcPrices;

    onProgress?.(`Running ${contractType} scenario…`, 50);
    const result = runScenario(prices, contractType, asset, lagThresh, edgeThresh, confThresh, kellyFrac, capital);

    // Skip full grid search (too slow in browser) — use a lightweight 2D search only
    onProgress?.('Finding optimal thresholds (quick search)…', 75);
    const best = quickSearch(prices, contractType, asset);
    onProgress?.('Done', 100);

    return {
      recommendedThresholds: best
        ? { lag: best.lag, edge: best.edge, confidence: best.conf }
        : { lag: lagThresh, edge: edgeThresh, confidence: confThresh },
      tradeCount: result.trades.length,
      winRate: result.winRate,
      totalPnl: result.totalPnl,
      maxDrawdown: result.maxDD,
      profitFactor: result.profitFactor,
      finalBalance: result.finalBalance,
      priceSeries: result.trades.slice(0, 200).map((t, idx) => ({
        idx: idx + 1,
        pnl: Number(t.pnl.toFixed(4)),
        balance: Number(t.balance.toFixed(2)),
        win: t.win,
      })),
      dataSource,
    };
  }

  // ── Grid-search (original behaviour) ─────────────────────────────────────
  onProgress?.('Running 200-trade grid search across BTC contracts…', 35);
  const btcBest5up  = gridSearch(btcPrices, '5min_up',  'BTC');
  const btcBest15up = gridSearch(btcPrices, '15min_up', 'BTC');

  onProgress?.('Running 200-trade grid search across ETH contracts…', 60);
  const ethBest5up  = gridSearch(ethPrices, '5min_up',  'ETH');
  const ethBest15up = gridSearch(ethPrices, '15min_up', 'ETH');

  onProgress?.('Averaging optimal thresholds…', 85);
  const results = [btcBest5up, btcBest15up, ethBest5up, ethBest15up].filter(Boolean);
  const avgLag  = Math.round(results.reduce((s, r) => s + r.lag,  0) / results.length);
  const avgEdge = Math.round(results.reduce((s, r) => s + r.edge, 0) / results.length);
  const avgConf = Math.round(results.reduce((s, r) => s + r.conf, 0) / results.length);
  const repResult = results.reduce((a, b) => (a?.score > b?.score ? a : b));

  onProgress?.('Backtest complete', 100);
  return {
    recommendedThresholds: { lag: avgLag, edge: avgEdge, confidence: avgConf },
    tradeCount: repResult?.trades?.length || 0,
    winRate: repResult?.winRate || 0,
    totalPnl: repResult?.totalPnl || 0,
    maxDrawdown: repResult?.maxDD || 0,
    profitFactor: repResult?.profitFactor || 0,
    finalBalance: repResult?.finalBalance || 1000,
    priceSeries: repResult?.trades?.slice(0, 200).map((t, idx) => ({
      idx: idx + 1,
      pnl: Number(t.pnl.toFixed(4)),
      balance: Number(t.balance.toFixed(2)),
      win: t.win,
    })) || [],
    dataSource,
  };
}