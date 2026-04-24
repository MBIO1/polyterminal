// Correlation Monitoring Module
//
// Monitors spot-perp correlation to ensure hedge effectiveness.
// Halts trading if correlation breaks down (<0.80).

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CORRELATION_THRESHOLD = 0.80;
const CORRELATION_WARNING = 0.90;
const MIN_DATA_POINTS = 20;

function calculateCorrelation(x, y) {
  if (x.length !== y.length || x.length < MIN_DATA_POINTS) return null;
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let covariance = 0, varianceX = 0, varianceY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX, dy = y[i] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  covariance /= n; varianceX /= n; varianceY /= n;
  const stdDevX = Math.sqrt(varianceX), stdDevY = Math.sqrt(varianceY);
  if (stdDevX === 0 || stdDevY === 0) return null;
  return covariance / (stdDevX * stdDevY);
}

function getCorrelationStatus(correlation) {
  if (correlation === null) return { status: 'unknown', severity: 'INFO' };
  if (correlation >= CORRELATION_WARNING) return { status: 'healthy', severity: 'INFO' };
  if (correlation >= CORRELATION_THRESHOLD) return { status: 'warning', severity: 'WARN' };
  return { status: 'critical', severity: 'CRITICAL' };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { pair } = body;

    // Get recent signals — filter by pair if provided
    const recentSignals = pair
      ? await base44.asServiceRole.entities.ArbSignal.filter({ pair }, '-received_time', 100)
      : await base44.asServiceRole.entities.ArbSignal.list('-received_time', 200);

    // Group by pair
    const pairsMap = {};
    recentSignals.forEach(signal => {
      if (!pairsMap[signal.pair]) pairsMap[signal.pair] = [];
      pairsMap[signal.pair].push({
        spotPrice: signal.buy_price,
        perpPrice: signal.sell_price,
      });
    });

    const results = [];
    for (const [p, data] of Object.entries(pairsMap)) {
      if (data.length < MIN_DATA_POINTS) {
        results.push({
          pair: p,
          correlation: null,
          status: 'insufficient_data',
          canTrade: true,
          dataPoints: data.length,
          needed: MIN_DATA_POINTS,
        });
        continue;
      }
      const spotPrices = data.map(d => d.spotPrice);
      const perpPrices = data.map(d => d.perpPrice);
      const correlation = calculateCorrelation(spotPrices, perpPrices);
      const { status, severity } = getCorrelationStatus(correlation);
      results.push({
        pair: p,
        correlation: correlation !== null ? Math.round(correlation * 1000) / 1000 : null,
        status,
        severity,
        canTrade: correlation === null || correlation >= CORRELATION_THRESHOLD,
        dataPoints: data.length,
        threshold: CORRELATION_THRESHOLD,
        timestamp: new Date().toISOString(),
      });
    }

    const criticalPairs = results.filter(r => r.status === 'critical');
    const warningPairs = results.filter(r => r.status === 'warning');
    const overallStatus = criticalPairs.length > 0 ? 'critical' : warningPairs.length > 0 ? 'warning' : 'healthy';

    return Response.json({
      ok: true,
      overall_status: overallStatus,
      can_trade: criticalPairs.length === 0,
      pairs_monitored: results.length,
      critical_count: criticalPairs.length,
      warning_count: warningPairs.length,
      healthy_count: results.filter(r => r.status === 'healthy').length,
      pairs: results,
      threshold: CORRELATION_THRESHOLD,
      warning_threshold: CORRELATION_WARNING,
    });

  } catch (error) {
    console.error('[correlationMonitor] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});