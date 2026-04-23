/**
 * CEX ARBITRAGE SKILL 2.0 - BASE44 EDITION
 * 
 * Integrated for polyterminal Base44 app
 * Frontend + Backend compatible
 */

// ════════════════════════════════════════════════════════════════
// BASE44 COMPATIBLE SKILL CLASS
// ════════════════════════════════════════════════════════════════

export class CEXArbitrageSkillBase44 {
  constructor(config = {}) {
    // ============================================
    // PILLAR 1: LOW-LATENCY INFRASTRUCTURE
    // ============================================
    this.latency = {
      websocket: {
        binance: [],
        okx: [],
        coinbase: [],
        polymarket: []
      },
      lastUpdate: {},
      maxLatencyMs: config.maxLatencyMs || 50,
      stalePeriodMs: config.stalePeriodMs || 5000
    };

    // ============================================
    // PILLAR 2: QUANTITATIVE EXECUTION & COST
    // ============================================
    this.costModel = {
      exchangeFees: {
        binance: { maker: 0.001, taker: 0.001 },
        okx: { maker: 0.001, taker: 0.0015 },
        coinbase: { maker: 0.005, taker: 0.006 },
        polymarket: { maker: 0.002, taker: 0.002 }
      },
      slippageModel: {}
    };

    // ============================================
    // PILLAR 3: SYSTEMATIC RISK & SAFETY
    // ============================================
    this.riskControl = {
      dailyLoss: 0,
      maxDailyLoss: config.maxDailyLoss || 500,
      positions: new Map(),
      maxPositionSkew: config.maxPositionSkew || 0.15,
      circuitBreakers: {
        volatility: false,
        liquidityDried: false,
        partialFillRisk: false,
        systemLag: false
      },
      healthScore: 100
    };

    // ============================================
    // SIGNAL QUALITY MONITORING
    // ============================================
    this.signalQuality = {
      healthy: [],
      stale: [],
      conflicting: [],
      confidence: 0,
      lastSignalTime: 0
    };

    // ============================================
    // MARKET STATE
    // ============================================
    this.market = {
      condition: 'NORMAL',
      volatility: 0,
      spreads: {},
      depth: {}
    };

    // ============================================
    // OBSERVABILITY & ALERTS
    // ============================================
    this.observability = {
      logs: [],
      alerts: [],
      metrics: {
        tradesExecuted: 0,
        profitRealized: 0,
        lossRealized: 0,
        partialFills: 0,
        circuitBreakerTrips: 0
      },
      callback: config.callback || null
    };

    this.config = config;
  }

  // ════════════════════════════════════════════════════════════════
  // PUBLIC API METHODS
  // ════════════════════════════════════════════════════════════════

  /**
   * Track WebSocket latency
   */
  trackLatency(exchange, latencyMs) {
    const now = Date.now();
    
    if (!this.latency.websocket[exchange]) {
      this.latency.websocket[exchange] = [];
    }
    
    this.latency.websocket[exchange].push({ latency: latencyMs, timestamp: now });
    
    if (this.latency.websocket[exchange].length > 100) {
      this.latency.websocket[exchange].shift();
    }
    
    this.latency.lastUpdate[exchange] = now;
    
    if (latencyMs > this.latency.maxLatencyMs) {
      this.alert('HIGH_LATENCY', `${exchange}: ${latencyMs}ms`, 'WARNING');
    }
    
    return {
      exchange,
      latencyMs,
      average: this.getAverageLatency(exchange),
      p95: this.getP95Latency(exchange),
      healthy: latencyMs <= this.latency.maxLatencyMs
    };
  }

  /**
   * Detect market staleness
   */
  detectStaleness() {
    const now = Date.now();
    const staleness = {};
    
    for (const [exchange, lastUpdate] of Object.entries(this.latency.lastUpdate)) {
      const timeSinceUpdate = now - lastUpdate;
      staleness[exchange] = {
        timeSinceUpdateMs: timeSinceUpdate,
        isStale: timeSinceUpdate > this.latency.stalePeriodMs,
        stalePenaltySeconds: Math.floor(timeSinceUpdate / 1000)
      };
      
      if (timeSinceUpdate > this.latency.stalePeriodMs) {
        this.market.condition = 'STALE';
        this.alert('STALE_DATA', `${exchange} no update for ${timeSinceUpdate}ms`, 'CRITICAL');
      }
    }
    
    return staleness;
  }

  /**
   * Calculate real spread after all costs
   */
  calculateRealSpread(buyExch, sellExch, bid, ask, size, vol1, vol2) {
    const buyFee = this.getTieredFee(buyExch, vol1);
    const sellFee = this.getTieredFee(sellExch, vol2);
    
    const buySlippage = size * 0.00001;
    const sellSlippage = size * 0.00001;
    
    const nominalSpread = ((ask - bid) / bid) * 10000;
    const totalFees = (buyFee + sellFee) * 10000;
    const slippage = (buySlippage + sellSlippage) * 10000;
    const netSpread = nominalSpread - totalFees - slippage;
    
    return {
      nominalSpreadBps: nominalSpread,
      totalTakerFeesBps: totalFees,
      slippageBps: slippage,
      netSpreadBps: netSpread,
      profitable: netSpread > 0,
      estimatedProfit: (ask - bid - buyFee - sellFee - buySlippage - sellSlippage) * size
    };
  }

  /**
   * Assess signal quality
   */
  assessSignalHealth(signals) {
    const now = Date.now();
    const assessment = {
      healthy: [],
      stale: [],
      conflicting: [],
      confidence: 0,
      recommendation: 'PROCEED'
    };
    
    signals.forEach(signal => {
      const age = now - signal.timestamp;
      if (age > 3000) {
        assessment.stale.push(signal);
      } else {
        assessment.healthy.push(signal);
      }
    });
    
    const healthyCount = assessment.healthy.length;
    const totalSignals = signals.length;
    
    assessment.confidence = totalSignals > 0 ? (healthyCount / totalSignals) * 100 : 0;
    
    if (assessment.confidence < 50) {
      assessment.recommendation = 'HALT';
    } else if (assessment.confidence < 75) {
      assessment.recommendation = 'CAUTION';
    }
    
    this.signalQuality = assessment;
    return assessment;
  }

  /**
   * Detect market health
   */
  detectMarketHealth() {
    const staleness = this.detectStaleness();
    const staleCount = Object.values(staleness).filter(s => s.isStale).length;
    const staleRatio = staleCount / Object.keys(staleness).length;
    
    let condition = 'HEALTHY';
    let advice = 'PROCEED';
    let riskLevel = 'LOW';
    
    if (staleRatio > 0.5) {
      condition = 'STALE';
      advice = 'HALT';
      riskLevel = 'CRITICAL';
    } else if (this.signalQuality.confidence < 60) {
      condition = 'UNCERTAIN';
      advice = 'REDUCE_SIZE';
      riskLevel = 'HIGH';
    } else if (this.market.volatility > 0.05) {
      condition = 'VOLATILE';
      advice = 'PROCEED_CAUTIOUS';
      riskLevel = 'MEDIUM';
    }
    
    return {
      timestamp: Date.now(),
      condition,
      advice,
      riskLevel,
      staleness,
      signalConfidence: this.signalQuality.confidence
    };
  }

  /**
   * Track position
   */
  trackPosition(exchange, pair, side, size, price) {
    const key = `${exchange}:${pair}`;
    
    if (!this.riskControl.positions.has(key)) {
      this.riskControl.positions.set(key, { 
        bought: 0, sold: 0, avgBuyPrice: 0, avgSellPrice: 0 
      });
    }
    
    const pos = this.riskControl.positions.get(key);
    
    if (side === 'BUY') {
      pos.bought += size;
      pos.avgBuyPrice = (pos.avgBuyPrice * (pos.bought - size) + price * size) / pos.bought;
    } else {
      pos.sold += size;
      pos.avgSellPrice = (pos.avgSellPrice * (pos.sold - size) + price * size) / pos.sold;
    }
    
    const totalSize = pos.bought + pos.sold;
    const buyRatio = pos.bought / totalSize;
    const skew = Math.abs(buyRatio - 0.5);
    
    if (skew > this.riskControl.maxPositionSkew) {
      this.triggerCircuitBreaker('POSITION_SKEW', `${key}: ${(skew * 100).toFixed(2)}%`);
    }
    
    return {
      position: pos,
      skewPercent: skew * 100,
      isSkewed: skew > this.riskControl.maxPositionSkew
    };
  }

  /**
   * Get comprehensive health report
   */
  getHealthReport() {
    return {
      timestamp: Date.now(),
      market: this.detectMarketHealth(),
      risk: {
        dailyLossUSD: this.riskControl.dailyLoss,
        maxDailyLossUSD: this.riskControl.maxDailyLoss,
        healthScore: this.riskControl.healthScore,
        positionsOpen: this.riskControl.positions.size
      },
      signals: {
        healthy: this.signalQuality.healthy.length,
        stale: this.signalQuality.stale.length,
        conflicting: this.signalQuality.conflicting.length,
        confidence: this.signalQuality.confidence
      },
      performance: this.observability.metrics,
      latency: {
        average: this.getAverageLatency('polymarket'),
        p95: this.getP95Latency('polymarket')
      }
    };
  }

  // ════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ════════════════════════════════════════════════════════════════

  getAverageLatency(exchange) {
    const readings = this.latency.websocket[exchange] || [];
    if (readings.length === 0) return 0;
    return readings.reduce((sum, r) => sum + r.latency, 0) / readings.length;
  }

  getP95Latency(exchange) {
    const readings = this.latency.websocket[exchange] || [];
    if (readings.length === 0) return 0;
    const sorted = readings.map(r => r.latency).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  }

  getTieredFee(exchange, volume) {
    const fees = this.costModel.exchangeFees[exchange];
    if (!fees) return 0.002;
    return volume > 100000 ? fees.maker : fees.taker;
  }

  triggerCircuitBreaker(reason, details) {
    const key = reason.toLowerCase().replace(/[^a-z]/g, '');
    this.riskControl.circuitBreakers[key] = true;
    
    const activeBreakers = Object.values(this.riskControl.circuitBreakers).filter(v => v).length;
    this.riskControl.healthScore = Math.max(0, 100 - (activeBreakers * 25));
    
    this.alert('CIRCUIT_BREAKER', `${reason}: ${details}`, 'CRITICAL');
  }

  alert(type, message, severity = 'INFO') {
    const alert = { type, message, severity, timestamp: Date.now() };
    this.observability.alerts.push(alert);
    
    if (this.observability.callback) {
      this.observability.callback(alert);
    }
  }
}

export default CEXArbitrageSkillBase44;
