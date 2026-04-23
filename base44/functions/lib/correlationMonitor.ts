// Correlation Monitoring Module
//
// Monitors spot-perp correlation to ensure hedge effectiveness
// Halt trading if correlation breaks down (<0.8)
// This prevents market-neutral from becoming directional

import { auditLog } from './auditLogger.ts';
import { recordFailure } from './circuitBreaker.ts';

const CORRELATION_THRESHOLD = 0.80; // Halt if below 80%
const CORRELATION_WARNING = 0.90; // Warning if below 90%
const MIN_DATA_POINTS = 20; // Minimum price points for calculation
const MONITORING_WINDOW_MS = 60 * 60 * 1000; // 1 hour window

/**
 * Calculate Pearson correlation coefficient
 */
export function calculateCorrelation(x, y) {
  if (x.length !== y.length || x.length < MIN_DATA_POINTS) {
    return null;
  }
  
  const n = x.length;
  
  // Calculate means
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  
  // Calculate covariance and variances
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  
  for (let i = 0; i < n; i++) {
    const diffX = x[i] - meanX;
    const diffY = y[i] - meanY;
    
    covariance += diffX * diffY;
    varianceX += diffX * diffX;
    varianceY += diffY * diffY;
  }
  
  covariance /= n;
  varianceX /= n;
  varianceY /= n;
  
  const stdDevX = Math.sqrt(varianceX);
  const stdDevY = Math.sqrt(varianceY);
  
  if (stdDevX === 0 || stdDevY === 0) return null;
  
  return covariance / (stdDevX * stdDevY);
}

/**
 * Get correlation status
 */
export function getCorrelationStatus(correlation) {
  if (correlation === null) return { status: 'unknown', severity: 'INFO' };
  if (correlation >= CORRELATION_WARNING) return { status: 'healthy', severity: 'INFO' };
  if (correlation >= CORRELATION_THRESHOLD) return { status: 'warning', severity: 'WARN' };
  return { status: 'critical', severity: 'CRITICAL' };
}

/**
 * Monitor correlation for a specific pair
 */
export async function monitorPairCorrelation(base44, pair, spotPrices, perpPrices) {
  const correlation = calculateCorrelation(spotPrices, perpPrices);
  
  if (correlation === null) {
    return {
      pair,
      correlation: null,
      status: 'insufficient_data',
      canTrade: false,
      reason: `Insufficient price data (${spotPrices.length} points, need ${MIN_DATA_POINTS})`,
    };
  }
  
  const status = getCorrelationStatus(correlation);
  
  const result = {
    pair,
    correlation: Math.round(correlation * 1000) / 1000, // 3 decimal places
    status: status.status,
    severity: status.severity,
    canTrade: correlation >= CORRELATION_THRESHOLD,
    threshold: CORRELATION_THRESHOLD,
    timestamp: new Date().toISOString(),
  };
  
  // Log if critical or warning
  if (status.severity !== 'INFO') {
    await auditLog(base44, {
      eventType: 'CORRELATION_ALERT',
      severity: status.severity,
      message: `Correlation ${status.status} for ${pair}: ${(correlation * 100).toFixed(1)}%`,
      details: result,
    });
    
    // Record failure if critical
    if (status.severity === 'CRITICAL') {
      await recordFailure(base44, 'correlation_breakdown', {
        pair,
        correlation,
        threshold: CORRELATION_THRESHOLD,
      });
    }
  }
  
  return result;
}

/**
 * Monitor all active pairs
 */
export async function monitorAllCorrelations(base44) {
  // Get recent price data from signals or trades
  const recentSignals = await base44.asServiceRole.entities.ArbSignal.list(
    '-received_time',
    100
  );
  
  // Group by pair
  const pairs = {};
  recentSignals.forEach(signal => {
    if (!pairs[signal.pair]) {
      pairs[signal.pair] = [];
    }
    pairs[signal.pair].push({
      spotPrice: signal.buy_price,
      perpPrice: signal.sell_price,
      timestamp: signal.received_time,
    });
  });
  
  const results = [];
  
  for (const [pair, data] of Object.entries(pairs)) {
    if (data.length < MIN_DATA_POINTS) continue;
    
    const spotPrices = data.map(d => d.spotPrice);
    const perpPrices = data.map(d => d.perpPrice);
    
    const result = await monitorPairCorrelation(base44, pair, spotPrices, perpPrices);
    results.push(result);
  }
  
  // Overall status
  const criticalPairs = results.filter(r => r.status === 'critical');
  const warningPairs = results.filter(r => r.status === 'warning');
  
  const overallStatus = criticalPairs.length > 0 ? 'critical' : 
                        warningPairs.length > 0 ? 'warning' : 'healthy';
  
  return {
    overall_status: overallStatus,
    pairs_monitored: results.length,
    critical_count: criticalPairs.length,
    warning_count: warningPairs.length,
    healthy_count: results.filter(r => r.status === 'healthy').length,
    pairs: results,
    can_trade: criticalPairs.length === 0,
  };
}

/**
 * Check correlation before executing trade
 */
export async function checkTradeCorrelation(base44, pair) {
  // Get recent price data for this pair
  const recentSignals = await base44.asServiceRole.entities.ArbSignal.filter(
    { pair },
    '-received_time',
    50
  );
  
  if (recentSignals.length < MIN_DATA_POINTS) {
    return {
      canTrade: true, // Allow if insufficient data
      correlation: null,
      status: 'insufficient_data',
      warning: 'Insufficient data for correlation check',
    };
  }
  
  const spotPrices = recentSignals.map(s => s.buy_price);
  const perpPrices = recentSignals.map(s => s.sell_price);
  
  const result = await monitorPairCorrelation(base44, pair, spotPrices, perpPrices);
  
  return {
    canTrade: result.canTrade,
    correlation: result.correlation,
    status: result.status,
    reason: result.canTrade ? null : `Correlation ${result.correlation} below threshold ${CORRELATION_THRESHOLD}`,
  };
}

/**
 * Get correlation summary for dashboard
 */
export async function getCorrelationSummary(base44) {
  const monitor = await monitorAllCorrelations(base44);
  
  return {
    status: monitor.overall_status,
    timestamp: new Date().toISOString(),
    summary: {
      total: monitor.pairs_monitored,
      healthy: monitor.healthy_count,
      warning: monitor.warning_count,
      critical: monitor.critical_count,
    },
    critical_pairs: monitor.pairs
      .filter(p => p.status === 'critical')
      .map(p => ({ pair: p.pair, correlation: p.correlation })),
    can_trade: monitor.can_trade,
  };
}

export default {
  calculateCorrelation,
  getCorrelationStatus,
  monitorPairCorrelation,
  monitorAllCorrelations,
  checkTradeCorrelation,
  getCorrelationSummary,
  CORRELATION_THRESHOLD,
  CORRELATION_WARNING,
  MIN_DATA_POINTS,
};
