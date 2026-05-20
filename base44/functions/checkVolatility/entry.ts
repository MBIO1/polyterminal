// checkVolatility — monitors market volatility to prevent execution in choppy conditions
// Industry standard: Pause execution when 1-minute price volatility exceeds 2%
//
// Usage: 
//   const { isVolatile, volatilityPct } = await checkVolatility('BTC-USDT');
//   if (isVolatile) { skip signal }

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const VOLATILITY_WINDOW_MS = 60_000; // 1 minute
const VOLATILITY_THRESHOLD_PCT = 2.0; // Pause if 1min vol > 2%

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }
    
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const pair = body.pair || 'BTC-USDT';
    
    // Fetch recent scan snapshots for this pair
    const snapshots = await base44.asServiceRole.entities.ArbScanSnapshot.filter(
      { asset: pair.split('-')[0] },
      '-snapshot_time',
      20
    );
    
    if (snapshots.length < 5) {
      return Response.json({
        is_volatile: false,
        volatility_pct: 0,
        warning: 'insufficient_data',
        pair,
      });
    }
    
    // Calculate 1-minute price volatility (standard deviation of returns)
    const prices = snapshots.slice(0, 10).map(s => Number(s.spot_price));
    const returns = [];
    
    for (let i = 1; i < prices.length; i++) {
      const ret = (prices[i] - prices[i-1]) / prices[i-1] * 100; // percentage return
      returns.push(ret);
    }
    
    if (returns.length < 3) {
      return Response.json({
        is_volatile: false,
        volatility_pct: 0,
        warning: 'insufficient_returns',
        pair,
      });
    }
    
    // Calculate standard deviation
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    const isVolatile = stdDev > VOLATILITY_THRESHOLD_PCT;
    
    return Response.json({
      is_volatile: isVolatile,
      volatility_pct: parseFloat(stdDev.toFixed(3)),
      threshold_pct: VOLATILITY_THRESHOLD_PCT,
      pair,
      sample_size: returns.length,
      mean_return_pct: parseFloat(mean.toFixed(4)),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});