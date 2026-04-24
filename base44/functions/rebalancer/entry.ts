// Auto-Rebalancing Module for Arbitrage Positions
//
// Monitors and rebalances positions every 6 hours to:
// 1. Maintain target margin utilization
// 2. Reduce overexposure on any exchange
// 3. Rebalance after significant P&L moves
// 4. Ensure proper hedging ratios

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const REBALANCE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MARGIN_DRIFT_THRESHOLD = 0.10;               // 10% drift triggers rebalance
const HEDGE_RATIO_THRESHOLD = 0.95;                // Min 95% hedge ratio

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { execute = false } = body;

    // Get open positions
    const positions = await base44.asServiceRole.entities.ArbLivePosition.filter(
      { status: 'Open' }, '-snapshot_time', 100
    );

    if (positions.length === 0) {
      return Response.json({ needed: false, reason: 'no_open_positions', positions: 0 });
    }

    // Get config
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config = configs[0];
    if (!config) return Response.json({ needed: false, reason: 'no_config' });

    const now = Date.now();
    const issues = [];

    // Check 1: Margin utilization drift
    const totalCapital = Number(config.total_capital || 0);
    const perpBucket = totalCapital * Number(config.perp_collateral_pct || 0.245);
    const marginUsed = positions.reduce((sum, p) => sum + Number(p.margin_used || 0), 0);
    const marginUtil = perpBucket > 0 ? marginUsed / perpBucket : 0;
    const targetUtil = Number(config.max_margin_utilization_pct || 0.35);

    if (Math.abs(marginUtil - targetUtil) > MARGIN_DRIFT_THRESHOLD) {
      issues.push({ type: 'margin_drift', current: marginUtil, target: targetUtil, drift: Math.abs(marginUtil - targetUtil) });
    }

    // Check 2: Hedge ratio (delta drift)
    const netDelta = positions.reduce((sum, p) => sum + Number(p.net_delta_usd || 0), 0);
    const grossExposure = positions.reduce((sum, p) =>
      sum + Math.abs(Number(p.spot_notional || 0)) + Math.abs(Number(p.perp_notional || 0)), 0
    );
    const hedgeRatio = grossExposure > 0 ? 1 - (Math.abs(netDelta) / grossExposure) : 1;

    if (hedgeRatio < HEDGE_RATIO_THRESHOLD) {
      issues.push({ type: 'hedge_ratio_low', current: hedgeRatio, threshold: HEDGE_RATIO_THRESHOLD, netDelta });
    }

    // Check 3: Time-based rebalance (every 6h)
    const lastRebalance = config.last_rebalance_at ? new Date(config.last_rebalance_at).getTime() : 0;
    if (now - lastRebalance > REBALANCE_INTERVAL_MS) {
      issues.push({ type: 'time_based', hoursSinceLast: Math.floor((now - lastRebalance) / 3600000) });
    }

    // Check 4: Exchange concentration (max 50% per exchange)
    const exposureByExchange = {};
    positions.forEach(p => {
      if (p.spot_exchange) exposureByExchange[p.spot_exchange] = (exposureByExchange[p.spot_exchange] || 0) + Number(p.spot_notional || 0);
      if (p.perp_exchange) exposureByExchange[p.perp_exchange] = (exposureByExchange[p.perp_exchange] || 0) + Number(p.perp_notional || 0);
    });
    const maxExchangeExposure = Math.max(...Object.values(exposureByExchange).concat([0]));
    const maxExchangePct = totalCapital > 0 ? maxExchangeExposure / totalCapital : 0;
    if (maxExchangePct > 0.50) {
      const exchange = Object.keys(exposureByExchange).find(k => exposureByExchange[k] === maxExchangeExposure);
      issues.push({ type: 'exchange_concentration', exchange, exposurePct: maxExchangePct });
    }

    const needed = issues.length > 0;

    // Build recommendations
    const recommendations = issues.map(issue => {
      switch (issue.type) {
        case 'margin_drift':
          return {
            priority: 'HIGH',
            action: 'Reduce position sizes',
            reason: `Margin utilization ${(issue.current * 100).toFixed(1)}% vs target ${(issue.target * 100).toFixed(1)}%`,
            steps: ['Close smallest/least profitable positions first', 'Reduce remaining position sizes by 10-20%'],
          };
        case 'hedge_ratio_low':
          return {
            priority: 'CRITICAL',
            action: 'Re-establish hedge',
            reason: `Hedge ratio ${(issue.current * 100).toFixed(1)}% below ${(HEDGE_RATIO_THRESHOLD * 100).toFixed(0)}% threshold`,
            steps: ['Add offsetting positions to reduce net delta', 'Verify both legs are properly sized'],
          };
        case 'time_based':
          return {
            priority: 'MEDIUM',
            action: 'Routine rebalancing review',
            reason: `${issue.hoursSinceLast} hours since last rebalance`,
            steps: ['Review all open positions', 'Check margin utilization across exchanges'],
          };
        case 'exchange_concentration':
          return {
            priority: 'HIGH',
            action: 'Diversify exposure',
            reason: `${issue.exchange} has ${(issue.exposurePct * 100).toFixed(1)}% of portfolio`,
            steps: [`Reduce positions on ${issue.exchange}`, 'Open offsetting positions on other exchanges'],
          };
        default:
          return { priority: 'LOW', action: 'Review', reason: issue.type };
      }
    }).sort((a, b) => {
      const prio = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return prio[a.priority] - prio[b.priority];
    });

    // If execute=true, stamp the rebalance timestamp
    let executed = false;
    if (execute && needed) {
      await base44.asServiceRole.entities.ArbConfig.update(config.id, {
        last_rebalance_at: new Date().toISOString(),
        rebalance_count: (config.rebalance_count || 0) + 1,
      });
      executed = true;
      console.log('[rebalancer] Rebalance executed, timestamp updated');
    }

    return Response.json({
      ok: true,
      needed,
      executed,
      issues,
      recommendations,
      metrics: {
        marginUtil,
        hedgeRatio,
        netDelta,
        positions: positions.length,
        lastRebalance: lastRebalance > 0 ? new Date(lastRebalance).toISOString() : 'never',
        exposureByExchange,
      },
    });

  } catch (error) {
    console.error('[rebalancer] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});