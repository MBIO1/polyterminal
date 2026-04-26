/**
 * ArbitrageEngine v2 — High-Efficiency Edition
 *
 * Key upgrades over v1:
 *  1. Fee-adjusted net spread  — stops you trading "profitable" spreads that lose after fees
 *  2. Parallel symbol fetching — Binance/Coinbase fetched concurrently, not one-by-one
 *  3. Per-symbol adaptive thresholds — each pair learns independently
 *  4. Circuit breaker          — pauses engine after consecutive losses
 *  5. Expected-value (EV) scoring — replaces the simplistic confidence formula
 *  6. Coefficient-of-variation noise filter — relative instead of absolute volatility
 *  7. Proper deduplicate cooldown per symbol (Map-based)
 *  8. Retry with exponential backoff on transient fetch errors
 */

// ─── Exchange fee table (taker fees as %) ────────────────────────────────────
const EXCHANGE_FEES = {
  binance:    0.10,   // 0.10% taker
  kraken:     0.26,   // 0.26% taker
  coinbase:   0.60,   // 0.60% taker (advanced trade)
  polymarket: 0.00,   // 0 maker/taker on CLOB
  okx:        0.08,   // 0.08% taker (VIP 0)
  bybit:      0.10,   // 0.10% taker
};

// ─── Slippage estimates per exchange (%) ─────────────────────────────────────
const SLIPPAGE_EST = {
  binance:    0.05,
  kraken:     0.10,
  coinbase:   0.10,
  polymarket: 0.15,
  okx:        0.05,
  bybit:      0.05,
};

class ArbitrageEngine {
  constructor(config = {}) {
    this.config = {
      minNetSpreadPct:    config.minNetSpreadPct    || 0.2,   // 0.2% = 20 bps (was 1.0%)
      noiseThreshold:     config.noiseThreshold     || 0.02,  // CV threshold (relative)
      learnMode:          config.learnMode          !== false,
      pollInterval:       config.pollInterval       || 3000,
      historySize:        config.historySize        || 100,
      maxTradeHistory:    config.maxTradeHistory    || 1000,
      cooldownMs:         config.cooldownMs         || 10000, // Per-symbol cooldown
      circuitBreakerLoss: config.circuitBreakerLoss || 3,     // Consecutive losses to pause
      circuitBreakerMs:   config.circuitBreakerMs   || 60000, // Pause duration
      fetchTimeoutMs:     config.fetchTimeoutMs     || 5000,
      fetchRetries:       config.fetchRetries       || 2,
      minConfidence:      config.minConfidence      || 60,    // Minimum confidence to signal
      ...config,
    };

    this.priceHistory       = {};       // symbol → number[]
    this.symbolThresholds   = {};       // symbol → minNetSpreadPct (per-symbol learning)
    this.symbolStats        = {};       // symbol → { wins, losses, pnl }
    this.performanceLog     = [];
    this.lastSignals        = new Map();  // symbol → timestamp (proper cooldown)
    this.opportunities      = [];
    this.isRunning          = false;
    this.consecutiveLosses  = 0;
    this.circuitOpenUntil   = 0;
  }

  // ─── Fetch helpers ───────────────────────────────────────────────────────

  /** fetch with timeout + exponential-backoff retries */
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
        await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt))); // 200 / 400 ms
      }
    }
  }

  /** Binance — fetch all symbols in parallel (was sequential) */
  async getBinancePrices() {
    const symbols = ['YESUSDT', 'NOUSDT', 'ETHUSDT', 'BTCUSDT', 'SOLUSDT'];
    try {
      const results = await Promise.allSettled(
        symbols.map(s =>
          this._fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${s}`)
        )
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

  /** Kraken — batch all pairs in one call */
  async getKrakenPrices() {
    try {
      const data = await this._fetch(
        'https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD'
      );
      const prices = {};
      if (data.result) {
        const MAP = { XXBTZUSD: 'BTCUSDT', XETHZUSD: 'ETHUSDT', SOLUSD: 'SOLUSDT' };
        for (const [k, v] of Object.entries(data.result)) {
          const sym = MAP[k] || k;
          prices[sym] = parseFloat(v.c[0]);
        }
      }
      return prices;
    } catch (e) {
      console.warn('⚠️ Kraken error:', e.message);
      return {};
    }
  }

  /** Coinbase — batch in parallel */
  async getCoinbasePrices() {
    const pairs = [['BTC-USD', 'BTCUSDT'], ['ETH-USD', 'ETHUSDT'], ['SOL-USD', 'SOLUSDT']];
    try {
      const results = await Promise.allSettled(
        pairs.map(([p]) =>
          this._fetch(`https://api.exchange.coinbase.com/products/${p}/ticker`)
        )
      );
      const prices = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.price)
          prices[pairs[i][1]] = parseFloat(r.value.price);
      });
      return prices;
    } catch (e) {
      console.warn('⚠️ Coinbase error:', e.message);
      return {};
    }
  }

  /** Polymarket CLOB */
  async getPolymarketPrices() {
    try {
      const data = await this._fetch('https://clob.polymarket.com/prices');
      const prices = {};
      if (Array.isArray(data)) {
        data.forEach(item => {
          if (item.token_id && item.price)
            prices[item.token_id] = parseFloat(item.price);
        });
      }
      return prices;
    } catch (e) {
      console.warn('⚠️ Polymarket error:', e.message);
      return {};
    }
  }

  /** OKX — fetch spot and perp prices */
  async getOKXPrices() {
    const symbols = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'AVAX-USDT', 'LINK-USDT'];
    try {
      const results = await Promise.allSettled(
        symbols.map(s =>
          this._fetch(`https://www.okx.com/api/v5/market/ticker?instId=${s}`)
        )
      );
      const prices = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.data?.[0]?.last)
          prices[symbols[i]] = parseFloat(r.value.data[0].last);
      });
      return prices;
    } catch (e) {
      console.warn('⚠️ OKX error:', e.message);
      return {};
    }
  }

  /** Bybit — fetch spot and perp prices */
  async getBybitPrices() {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'LINKUSDT'];
    try {
      const results = await Promise.allSettled(
        symbols.map(s =>
          this._fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${s}`)
        )
      );
      const prices = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.result?.list?.[0]?.lastPrice)
          prices[symbols[i]] = parseFloat(r.value.result.list[0].lastPrice);
      });
      return prices;
    } catch (e) {
      console.warn('⚠️ Bybit error:', e.message);
      return {};
    }
  }

  async fetchPrices() {
    try {
      const [binance, kraken, coinbase, polymarket, okx, bybit] = await Promise.all([
        this.getBinancePrices(),
        this.getKrakenPrices(),
        this.getCoinbasePrices(),
        this.getPolymarketPrices(),
        this.getOKXPrices(),
        this.getBybitPrices(),
      ]);
      return { binance, kraken, coinbase, polymarket, okx, bybit };
    } catch (e) {
      console.error('❌ fetchPrices failed:', e.message);
      return null;
    }
  }

  // ─── Noise filter (Coefficient of Variation) ────────────────────────────

  /**
   * CV = stddev / mean — relative measure, works for all price ranges.
   * Low CV → prices barely moving → likely noise.
   */
  isNoiseSignal(symbol, currentPrice) {
    const history = this.priceHistory[symbol];
    if (!history || history.length < 5) return false;

    const recent = history.slice(-5);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (mean === 0) return false;
    const variance = recent.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / recent.length;
    const cv = Math.sqrt(variance) / mean;   // relative volatility

    if (cv < this.config.noiseThreshold) {
      console.log(`🔇 Noise (CV ${cv.toFixed(4)} < ${this.config.noiseThreshold}): ${symbol}`);
      return true;
    }
    return false;
  }

  // ─── Fee-adjusted net spread ─────────────────────────────────────────────

  /**
   * Gross spread minus round-trip fees & slippage on both legs.
   * A 2% spread with 0.86% total cost → 1.14% net — real profit metric.
   */
  netSpread(grossSpreadPct, buyExchange, sellExchange) {
    const fees =
      (EXCHANGE_FEES[buyExchange]  || 0) +
      (EXCHANGE_FEES[sellExchange] || 0) +
      (SLIPPAGE_EST[buyExchange]   || 0.1) +
      (SLIPPAGE_EST[sellExchange]  || 0.1);
    return grossSpreadPct - fees;
  }

  // ─── EV-based confidence score ───────────────────────────────────────────

  /**
   * Factors: net spread vs threshold, exchange count, symbol track record.
   * Returns 0–100.
   */
  calcConfidence(netSpreadPct, symbol, exchangeCount) {
    // How many multiples of threshold is this spread?
    const threshold = this.getSymbolThreshold(symbol);
    const spreadScore  = Math.min((netSpreadPct / threshold) * 50, 50);   // max 50 pts

    // More exchanges = more price confirmation
    const exchScore    = Math.min((exchangeCount - 1) * 10, 20);           // max 20 pts

    // Historical win rate for this symbol (0–30 pts)
    const ss = this.symbolStats[symbol];
    let histScore = 15; // neutral default
    if (ss && (ss.wins + ss.losses) >= 5) {
      histScore = (ss.wins / (ss.wins + ss.losses)) * 30;
    }

    return Math.min(Math.round(spreadScore + exchScore + histScore), 100);
  }

  // ─── Per-symbol threshold ────────────────────────────────────────────────

  getSymbolThreshold(symbol) {
    return this.symbolThresholds[symbol] ?? this.config.minNetSpreadPct;
  }

  // ─── Main detection ──────────────────────────────────────────────────────

  detectArbitrage(priceData) {
    const spreads = [];
    const symbols = new Set(
      Object.values(priceData).flatMap(ex => Object.keys(ex))
    );

    for (const symbol of symbols) {
      const pricePoints = [];
      for (const [exchange, data] of Object.entries(priceData)) {
        if (data[symbol] != null) {
          pricePoints.push({ exchange, price: data[symbol] });
        }
      }
      if (pricePoints.length < 2) continue;

      const prices    = pricePoints.map(p => p.price);
      const minP      = Math.min(...prices);
      const maxP      = Math.max(...prices);
      const grossSprd = ((maxP - minP) / minP) * 100;

      // Update rolling price history
      if (!this.priceHistory[symbol]) this.priceHistory[symbol] = [];
      this.priceHistory[symbol].push(minP);
      if (this.priceHistory[symbol].length > this.config.historySize)
        this.priceHistory[symbol].shift();

      const buyEntry  = pricePoints.find(p => p.price === minP);
      const sellEntry = pricePoints.find(p => p.price === maxP);

      const net = this.netSpread(grossSprd, buyEntry.exchange, sellEntry.exchange);
      const confidence = this.calcConfidence(net, symbol, pricePoints.length);

      if (
        !this.isNoiseSignal(symbol, minP) &&
        net >= this.getSymbolThreshold(symbol) &&
        confidence >= this.config.minConfidence
      ) {
        spreads.push({
          symbol,
          grossSpread:   grossSprd.toFixed(2),
          netSpread:     net.toFixed(2),           // ← new: fee-adjusted
          spread:        net.toFixed(2),           // alias for backward compat
          buyExchange:   buyEntry.exchange,
          sellExchange:  sellEntry.exchange,
          buyPrice:      minP.toFixed(4),
          sellPrice:     maxP.toFixed(4),
          exchangeCount: pricePoints.length,
          confidence,
          timestamp:     new Date().toISOString(),
        });
      }
    }

    spreads.sort((a, b) => parseFloat(b.netSpread) - parseFloat(a.netSpread));
    this.opportunities = spreads.slice(0, 10);
    return spreads;
  }

  // ─── Circuit breaker ─────────────────────────────────────────────────────

  isCircuitOpen() {
    if (Date.now() < this.circuitOpenUntil) {
      console.warn(`⚡ Circuit breaker OPEN — resuming in ${Math.ceil((this.circuitOpenUntil - Date.now()) / 1000)}s`);
      return true;
    }
    return false;
  }

  // ─── Trade recording & learning ──────────────────────────────────────────

  recordTrade(symbol, intendedSpread, executedSpread, pnl) {
    const won = pnl > 0;

    // Circuit breaker logic
    if (!won) {
      this.consecutiveLosses++;
      if (this.consecutiveLosses >= this.config.circuitBreakerLoss) {
        this.circuitOpenUntil = Date.now() + this.config.circuitBreakerMs;
        console.warn(`⚡ Circuit breaker triggered (${this.consecutiveLosses} consecutive losses). Pausing ${this.config.circuitBreakerMs / 1000}s`);
        this.consecutiveLosses = 0;
      }
    } else {
      this.consecutiveLosses = 0;
    }

    // Per-symbol stats
    if (!this.symbolStats[symbol]) this.symbolStats[symbol] = { wins: 0, losses: 0, pnl: 0 };
    this.symbolStats[symbol][won ? 'wins' : 'losses']++;
    this.symbolStats[symbol].pnl += pnl;

    const trade = {
      symbol,
      intendedSpread: parseFloat(intendedSpread),
      executedSpread: parseFloat(executedSpread),
      pnl:            parseFloat(pnl),
      timestamp:      Date.now(),
      success:        won,
    };
    this.performanceLog.push(trade);
    if (this.performanceLog.length > this.config.maxTradeHistory)
      this.performanceLog.shift();

    if (this.config.learnMode && this.performanceLog.length > 10) {
      this.updateThresholds(symbol);
    }

    console.log(
      `📊 ${symbol} ${won ? '✅' : '❌'} | ` +
      `intended: ${intendedSpread}% executed: ${executedSpread}% pnl: $${pnl.toFixed(2)}`
    );
  }

  /**
   * Per-symbol adaptive threshold.
   * Each symbol adjusts its own floor independently — faster convergence.
   */
  updateThresholds(symbol) {
    const ss = this.symbolStats[symbol];
    if (!ss || (ss.wins + ss.losses) < 5) return;

    const winRate = ss.wins / (ss.wins + ss.losses);
    const current = this.getSymbolThreshold(symbol);

    if (winRate < 0.60) {
      this.symbolThresholds[symbol] = Math.min(current + 0.15, 6.0);
      console.log(`📈 [${symbol}] win rate ${(winRate*100).toFixed(1)}% → threshold ↑ ${this.symbolThresholds[symbol].toFixed(2)}%`);
    } else if (winRate > 0.80 && current > 1.0) {
      this.symbolThresholds[symbol] = Math.max(current - 0.05, 1.0);
      console.log(`📉 [${symbol}] win rate ${(winRate*100).toFixed(1)}% → threshold ↓ ${this.symbolThresholds[symbol].toFixed(2)}%`);
    }
  }

  // ─── Stats ───────────────────────────────────────────────────────────────

  getStats() {
    const log = this.performanceLog;
    if (!log.length) return { winRate: 0, totalTrades: 0, totalPnl: 0, avgSpread: 0 };

    const wins     = log.filter(t => t.success).length;
    const totalPnl = log.reduce((s, t) => s + t.pnl, 0);
    const avgSprd  = log.reduce((s, t) => s + t.executedSpread, 0) / log.length;
    const avgProfit =
      wins > 0
        ? log.filter(t => t.success).reduce((s, t) => s + t.pnl, 0) / wins
        : 0;

    // Simple Sharpe approximation (no risk-free rate)
    const pnls     = log.map(t => t.pnl);
    const meanPnl  = totalPnl / log.length;
    const stdPnl   = Math.sqrt(pnls.reduce((s, p) => s + Math.pow(p - meanPnl, 2), 0) / log.length);
    const sharpe   = stdPnl > 0 ? (meanPnl / stdPnl).toFixed(2) : 'N/A';

    return {
      winRate:          ((wins / log.length) * 100).toFixed(1),
      totalTrades:      log.length,
      successCount:     wins,
      totalPnl:         totalPnl.toFixed(2),
      avgSpread:        avgSprd.toFixed(3),
      avgProfit:        avgProfit.toFixed(2),
      sharpeRatio:      sharpe,                   // ← new
      symbolThresholds: { ...this.symbolThresholds },  // ← new
      circuitBreaker:   Date.now() < this.circuitOpenUntil,  // ← new
    };
  }

  // ─── Main loop ───────────────────────────────────────────────────────────

  async start(onOpportunity) {
    if (this.isRunning) { console.warn('Already running'); return; }
    this.isRunning = true;
    console.log('🚀 ArbitrageEngine v2 started');
    console.log(`   Min net spread : ${this.config.minNetSpreadPct}% (fee-adjusted)`);
    console.log(`   Noise threshold: CV ${this.config.noiseThreshold}`);
    console.log(`   Circuit breaker: ${this.config.circuitBreakerLoss} consecutive losses`);
    console.log(`   Learn mode     : ${this.config.learnMode}\n`);

    this._interval = setInterval(async () => {
      if (!this.isRunning) return;
      if (this.isCircuitOpen()) return;

      const prices = await this.fetchPrices();
      if (!prices) return;

      const spreads = this.detectArbitrage(prices);
      const now = Date.now();

      spreads.forEach(spread => {
        const lastSignal = this.lastSignals.get(spread.symbol) || 0;
        if (now - lastSignal < this.config.cooldownMs) return;

        this.lastSignals.set(spread.symbol, now);
        if (onOpportunity) onOpportunity(spread);

        console.log(
          `✅ ${spread.symbol} | net: ${spread.netSpread}% (gross: ${spread.grossSpread}%) | ` +
          `${spread.buyExchange} → ${spread.sellExchange} | confidence: ${spread.confidence}%`
        );
      });
    }, this.config.pollInterval);
  }

  stop() {
    this.isRunning = false;
    clearInterval(this._interval);
    console.log('⏹️ Engine stopped');
  }

  exportPerformance() {
    return {
      stats:  this.getStats(),
      trades: this.performanceLog,
      config: {
        minNetSpreadPct: this.config.minNetSpreadPct,
        noiseThreshold:  this.config.noiseThreshold,
        learnMode:       this.config.learnMode,
      },
      symbolThresholds: this.symbolThresholds,
      timestamp: new Date().toISOString(),
    };
  }

  getOpportunities() { return this.opportunities; }
  resetStats() {
    this.performanceLog = [];
    this.symbolStats    = {};
    this.symbolThresholds = {};
    this.consecutiveLosses = 0;
    console.log('📊 Stats reset');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ArbitrageEngine;
}
