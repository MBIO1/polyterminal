/**
 * ArbitrageEngine v3 — OKX + Bybit Spot/Perp Basis Scanner
 *
 * Fixes from v2:
 *  1. Symbol key normalization — OKX 'BTC-USDT' → 'BTCUSDT' so all venues align
 *  2. Perp book scanning — fetches OKX-swap and Bybit-perp for basis arb
 *  3. Noise filter removed — CV filter was suppressing valid trending-market signals
 *  4. Route names use exact ingestSignal/executeSignals expected format (e.g. 'bybit-spot', 'okx-perp')
 */

// ─── Exchange fee table (taker fees as %) ────────────────────────────────────
// Real Bybit fees: spot=0.10%, linear perp=0.055%
// Binance: 0.10% spot. OKX: 0.08% spot, 0.05% perp.
const EXCHANGE_FEES = {
  'binance':    0.10,
  'okx-spot':   0.08,
  'okx-perp':   0.05,
  'bybit-spot': 0.10,
  'bybit-perp': 0.055,
};

// ─── Slippage estimates per exchange (%) ─────────────────────────────────────
// Conservative 1-2 bps slippage for liquid BTC/ETH/SOL
const SLIPPAGE_EST = {
  'binance':    0.01,
  'okx-spot':   0.01,
  'okx-perp':   0.01,
  'bybit-spot': 0.01,
  'bybit-perp': 0.01,
};

// Normalize any symbol to BTCUSDT-style key
function normalizeSym(s) {
  return s.replace('-', '').replace('/', '').toUpperCase();
}

class ArbitrageEngine {
  constructor(config = {}) {
    this.config = {
      minNetSpreadPct:    config.minNetSpreadPct    ?? 0.03,   // 3 bps = 0.03% — matches ingestSignal floor
      pollInterval:       config.pollInterval       ?? 2000,
      cooldownMs:         config.cooldownMs         ?? 5000,
      fetchTimeoutMs:     config.fetchTimeoutMs     ?? 6000,
      fetchRetries:       config.fetchRetries       ?? 1,
      minConfidence:      config.minConfidence      ?? 0,      // disabled — let edge floor do the work
      ...config,
    };

    this.opportunities  = [];
    this.isRunning      = false;
    this.lastSignals    = new Map(); // sym:route → timestamp
  }

  // ─── Fetch helpers ───────────────────────────────────────────────────────

  async _fetch(url, retries = this.config.fetchRetries) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.fetchTimeoutMs);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
      }
    }
  }

  // ─── OKX spot prices ─────────────────────────────────────────────────────

  async getOKXSpotPrices() {
    const symbols = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT'];
    try {
      const results = await Promise.allSettled(
        symbols.map(s => this._fetch(`https://www.okx.com/api/v5/market/ticker?instId=${s}`))
      );
      const prices = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.data?.[0]?.last)
          prices[normalizeSym(symbols[i])] = parseFloat(r.value.data[0].last);
      });
      return prices;
    } catch (e) {
      console.warn('⚠️ OKX spot error:', e.message);
      return {};
    }
  }

  // ─── OKX perp prices ─────────────────────────────────────────────────────

  async getOKXPerpPrices() {
    const symbols = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP'];
    try {
      const results = await Promise.allSettled(
        symbols.map(s => this._fetch(`https://www.okx.com/api/v5/market/ticker?instId=${s}`))
      );
      const prices = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.data?.[0]?.last) {
          // Map BTC-USDT-SWAP → BTCUSDT
          const base = symbols[i].replace('-USDT-SWAP', '').replace('-', '');
          prices[`${base}USDT`] = parseFloat(r.value.data[0].last);
        }
      });
      return prices;
    } catch (e) {
      console.warn('⚠️ OKX perp error:', e.message);
      return {};
    }
  }

  // ─── Bybit spot prices ───────────────────────────────────────────────────

  async getBybitSpotPrices() {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    try {
      const results = await Promise.allSettled(
        symbols.map(s => this._fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${s}`))
      );
      const prices = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.result?.list?.[0]?.lastPrice)
          prices[symbols[i]] = parseFloat(r.value.result.list[0].lastPrice);
      });
      return prices;
    } catch (e) {
      console.warn('⚠️ Bybit spot error:', e.message);
      return {};
    }
  }

  // ─── Bybit perp prices ───────────────────────────────────────────────────

  async getBybitPerpPrices() {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    try {
      const results = await Promise.allSettled(
        symbols.map(s => this._fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${s}`))
      );
      const prices = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.result?.list?.[0]?.lastPrice)
          prices[symbols[i]] = parseFloat(r.value.result.list[0].lastPrice);
      });
      return prices;
    } catch (e) {
      console.warn('⚠️ Bybit perp error:', e.message);
      return {};
    }
  }

  // ─── Binance spot (reference) ────────────────────────────────────────────

  async getBinanceSpotPrices() {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    try {
      const results = await Promise.allSettled(
        symbols.map(s => this._fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${s}`))
      );
      const prices = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.price)
          prices[symbols[i]] = parseFloat(r.value.price);
      });
      return prices;
    } catch (e) {
      console.warn('⚠️ Binance error:', e.message);
      return {};
    }
  }

  async fetchPrices() {
    const [okxSpot, okxPerp, bybitSpot, bybitPerp, binanceSpot] = await Promise.all([
      this.getOKXSpotPrices(),
      this.getOKXPerpPrices(),
      this.getBybitSpotPrices(),
      this.getBybitPerpPrices(),
      this.getBinanceSpotPrices(),
    ]);
    return { 'okx-spot': okxSpot, 'okx-perp': okxPerp, 'bybit-spot': bybitSpot, 'bybit-perp': bybitPerp, 'binance': binanceSpot };
  }

  // ─── Fee-adjusted net spread ──────────────────────────────────────────────

  netSpread(grossSpreadPct, buyExchange, sellExchange) {
    const fees =
      (EXCHANGE_FEES[buyExchange]  || 0.10) +
      (EXCHANGE_FEES[sellExchange] || 0.10) +
      (SLIPPAGE_EST[buyExchange]   || 0.05) +
      (SLIPPAGE_EST[sellExchange]  || 0.05);
    return grossSpreadPct - fees;
  }

  // ─── Main detection ───────────────────────────────────────────────────────

  detectArbitrage(priceData) {
    const spreads = [];

    // Collect all (symbol, exchange, price) tuples
    const allPoints = []; // { sym, exchange, price }
    for (const [exchange, data] of Object.entries(priceData)) {
      for (const [sym, price] of Object.entries(data)) {
        if (price > 0) allPoints.push({ sym: normalizeSym(sym), exchange, price });
      }
    }

    // Group by normalized symbol
    const bySymbol = {};
    for (const pt of allPoints) {
      if (!bySymbol[pt.sym]) bySymbol[pt.sym] = [];
      bySymbol[pt.sym].push(pt);
    }

    for (const [sym, points] of Object.entries(bySymbol)) {
      if (points.length < 2) continue;

      // Compare every pair of (exchange_A, exchange_B)
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const a = points[i];
          const b = points[j];
          if (a.exchange === b.exchange) continue;

          const buyEntry  = a.price < b.price ? a : b;
          const sellEntry = a.price < b.price ? b : a;

          const grossPct = ((sellEntry.price - buyEntry.price) / buyEntry.price) * 100;
          if (grossPct <= 0) continue;

          const netPct = this.netSpread(grossPct, buyEntry.exchange, sellEntry.exchange);
          if (netPct < this.config.minNetSpreadPct) continue;

          // Must have at least one Bybit leg (our execution venue)
          const hasBybit = buyEntry.exchange.startsWith('bybit') || sellEntry.exchange.startsWith('bybit');
          if (!hasBybit) continue;

          spreads.push({
            symbol:        sym,
            grossSpread:   grossPct.toFixed(4),
            netSpread:     netPct.toFixed(4),
            buyExchange:   buyEntry.exchange,
            sellExchange:  sellEntry.exchange,
            buyPrice:      buyEntry.price,
            sellPrice:     sellEntry.price,
            exchangeCount: points.length,
            confidence:    80, // static — edge floor is the real gate
            timestamp:     new Date().toISOString(),
          });
        }
      }
    }

    spreads.sort((a, b) => parseFloat(b.netSpread) - parseFloat(a.netSpread));
    this.opportunities = spreads.slice(0, 10);
    return spreads;
  }

  // ─── Report heartbeat to Base44 ──────────────────────────────────────────

  async reportHeartbeat(stats) {
    const BASE44_HEARTBEAT_URL = process.env.BASE44_HEARTBEAT_URL || 'https://polytrade.base44.app/functions/ingestHeartbeat';
    const BOT_SECRET = process.env.BOT_SECRET || process.env.DROPLET_SECRET || '';
    const heartbeatData = {
      snapshot_time:     new Date().toISOString(),
      evaluations:       stats.evaluations || 0,
      posted:            stats.signals || 0,
      rejected_edge:     stats.rejectedEdge || 0,
      rejected_fillable: stats.rejectedFillable || 0,
      rejected_stale:    stats.rejectedStale || 0,
      best_edge_bps:     stats.bestEdge || 0,
      best_edge_pair:    stats.bestPair || '',
      best_edge_route:   stats.bestRoute || '',
      fresh_books:       stats.freshBooks || '',
      post_errors:       stats.errors || 0,
      post_non_2xx:      stats.non2xx || 0,
    };
    try {
      const res = await fetch(BASE44_HEARTBEAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BOT_SECRET}` },
        body: JSON.stringify(heartbeatData),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) stats.non2xx = (stats.non2xx || 0) + 1;
      console.log(`💓 Heartbeat sent — evals:${stats.evaluations} signals:${stats.signals} bestEdge:${stats.bestEdge?.toFixed(1)}bps`);
    } catch (e) {
      stats.errors = (stats.errors || 0) + 1;
      console.warn('⚠️ Heartbeat failed:', e.message);
    }
  }

  // ─── Main loop ────────────────────────────────────────────────────────────

  async start(onOpportunity) {
    if (this.isRunning) { console.warn('Already running'); return; }
    this.isRunning = true;
    console.log('🚀 ArbitrageEngine v3 started');
    console.log(`   Min net spread: ${this.config.minNetSpreadPct}% (${this.config.minNetSpreadPct * 100} bps)`);
    console.log(`   Poll interval: ${this.config.pollInterval}ms`);
    console.log(`   Venues: okx-spot, okx-perp, bybit-spot, bybit-perp, binance\n`);

    let evaluations = 0;
    let signals = 0;
    let errors = 0;
    let non2xx = 0;
    let bestEdgeBps = 0;
    let bestEdgePair = '';
    let bestEdgeRoute = '';

    this._interval = setInterval(async () => {
      if (!this.isRunning) return;

      evaluations++;

      try {
        const prices = await this.fetchPrices();
        if (!prices) { errors++; return; }

        const spreads = this.detectArbitrage(prices);
        const now = Date.now();

        // Track best edge seen this interval
        for (const spread of spreads) {
          const edgeBps = parseFloat(spread.netSpread) * 100;
          if (edgeBps > bestEdgeBps) {
            bestEdgeBps = edgeBps;
            bestEdgePair = spread.symbol;
            bestEdgeRoute = `${spread.buyExchange}->${spread.sellExchange}`;
          }
        }

        for (const spread of spreads) {
          const key = `${spread.symbol}:${spread.buyExchange}->${spread.sellExchange}`;
          const lastSignal = this.lastSignals.get(key) || 0;
          if (now - lastSignal < this.config.cooldownMs) continue;

          this.lastSignals.set(key, now);
          signals++;
          if (onOpportunity) await onOpportunity(spread);

          console.log(`✅ ${spread.symbol} net:${(parseFloat(spread.netSpread)*100).toFixed(1)}bps gross:${(parseFloat(spread.grossSpread)*100).toFixed(1)}bps ${spread.buyExchange}→${spread.sellExchange}`);
        }

        // Log every evaluation so the droplet logs show activity
        if (evaluations % 5 === 0) {
          const bestBps = (parseFloat(spreads[0]?.netSpread || 0) * 100).toFixed(1);
          console.log(`📊 eval:${evaluations} spreads_found:${spreads.length} best:${bestBps}bps signals:${signals}`);
        }

        // Heartbeat every 30 evaluations (~1 min at 2s poll)
        if (evaluations % 30 === 0) {
          const freshBooks = Object.entries(prices)
            .map(([ex, data]) => {
              const cnt = Object.keys(data).length;
              return cnt > 0 ? `${ex}:${cnt}/${cnt}` : null;
            })
            .filter(Boolean)
            .join(' ');

          await this.reportHeartbeat({ evaluations, signals, errors, non2xx, bestEdge: bestEdgeBps, bestPair: bestEdgePair, bestRoute: bestEdgeRoute, freshBooks });
        }

      } catch (e) {
        errors++;
        console.error('❌ Main loop error:', e.message);
      }
    }, this.config.pollInterval);
  }

  stop() {
    this.isRunning = false;
    clearInterval(this._interval);
    console.log('⏹️ Engine stopped');
  }

  getOpportunities() { return this.opportunities; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ArbitrageEngine;
}