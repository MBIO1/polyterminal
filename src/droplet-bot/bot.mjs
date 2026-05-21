/**
 * ArbitrageEngine v3 — Bybit Spot/Perp Basis Scanner
 *
 * Scans Bybit spot vs Bybit perp for same-venue basis arbitrage opportunities.
 */

// ─── Exchange fee table (taker fees in basis points) ─────────────────────────
// Real Bybit taker fees: spot=10 bps (0.10%), perp=5.5 bps (0.055%)
const EXCHANGE_FEES_BPS = {
  'bybit-spot': 10,
  'bybit-perp': 5.5,
};

// Total taker fees for spot→perp carry trade (long spot, short perp)
const TOTAL_TAKER_FEES_BPS = EXCHANGE_FEES_BPS['bybit-spot'] + EXCHANGE_FEES_BPS['bybit-perp']; // 15.5 bps

// ─── Slippage estimates per exchange (bps) ───────────────────────────────────
// Conservative 1-2 bps slippage for liquid BTC/ETH/SOL
const SLIPPAGE_EST_BPS = {
  'bybit-spot': 1,
  'bybit-perp': 1,
};

const TOTAL_SLIPPAGE_BPS = SLIPPAGE_EST_BPS['bybit-spot'] + SLIPPAGE_EST_BPS['bybit-perp']; // 2 bps

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

  // ─── Bybit spot prices ───────────────────────────────────────────────────

  async getBybitSpotPrices() {
    const symbols = ['BTCUSDT', 'ETHUSDT'];
    try {
      const results = await Promise.allSettled(
        symbols.map(s => this._fetch(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${s}&limit=1`))
      );
      const prices = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.result?.bids?.[0]?.[0] && r.value?.result?.asks?.[0]?.[0]) {
          prices[symbols[i]] = {
            bid: parseFloat(r.value.result.bids[0][0]),
            ask: parseFloat(r.value.result.asks[0][0])
          };
        }
      });
      return prices;
    } catch (e) {
      console.warn('⚠️ Bybit spot orderbook error:', e.message);
      return {};
    }
  }

  // ─── Bybit perp orderbook ───────────────────────────────────────────────────

  async getBybitPerpPrices() {
    const symbols = ['BTCUSDT', 'ETHUSDT'];
    try {
      const results = await Promise.allSettled(
        symbols.map(s => this._fetch(`https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${s}&limit=1`))
      );
      const prices = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.result?.bids?.[0]?.[0] && r.value?.result?.asks?.[0]?.[0]) {
          prices[symbols[i]] = {
            bid: parseFloat(r.value.result.bids[0][0]),
            ask: parseFloat(r.value.result.asks[0][0])
          };
        }
      });
      return prices;
    } catch (e) {
      console.warn('⚠️ Bybit perp orderbook error:', e.message);
      return {};
    }
  }

  async fetchPrices() {
    const [bybitSpot, bybitPerp] = await Promise.all([
      this.getBybitSpotPrices(),
      this.getBybitPerpPrices(),
    ]);
    return { 'bybit-spot': bybitSpot, 'bybit-perp': bybitPerp };
  }

  // ─── Real Bybit Spot/Perp Basis Detection ──────────────────────────────────

  detectArbitrage(priceData) {
    const spreads = [];
    const spotBook = priceData['bybit-spot'] || {};
    const perpBook = priceData['bybit-perp'] || {};

    // Scan each symbol for spot→perp basis opportunities
    for (const symbol of Object.keys(spotBook)) {
      const spotData = spotBook[symbol];
      const perpData = perpBook[symbol];
      
      if (!spotData || !perpData) continue;

      // Real Bybit trading behavior:
      // Long Spot @ ask, Short Perp @ bid
      const spotAsk = spotData.ask;
      const perpBid = perpData.bid;

      if (spotAsk <= 0 || perpBid <= 0) continue;

      // Calculate gross spread in basis points
      const grossSpreadBps = ((perpBid - spotAsk) / spotAsk) * 10000;
      
      if (grossSpreadBps <= 0) continue;

      // Subtract exact Bybit taker fees (spot 10 bps + perp 5.5 bps = 15.5 bps)
      const netEdgeBps = grossSpreadBps - TOTAL_TAKER_FEES_BPS - TOTAL_SLIPPAGE_BPS;

      // Convert to percentage for compatibility with existing config
      const netSpreadPct = netEdgeBps / 100;

      if (netSpreadPct >= this.config.minNetSpreadPct) {
        spreads.push({
          symbol:        symbol.replace('USDT', '-USDT'),
          grossSpread:   (grossSpreadBps / 100).toFixed(4), // convert to %
          netSpread:     (netSpreadPct).toFixed(4),
          buyExchange:   'bybit-spot',
          sellExchange:  'bybit-perp',
          buyPrice:      spotAsk,
          sellPrice:     perpBid,
          exchangeCount: 2,
          confidence:    80,
          timestamp:     new Date().toISOString(),
        });

        console.log(`🎯 ${symbol} gross:${grossSpreadBps.toFixed(1)}bps net:${netEdgeBps.toFixed(1)}bps (fees:${TOTAL_TAKER_FEES_BPS}bps slip:${TOTAL_SLIPPAGE_BPS}bps)`);
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
    console.log(`   Venues: bybit-spot, bybit-perp\n`);

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