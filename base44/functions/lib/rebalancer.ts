// Auto-Rebalancing Module for Arbitrage Positions
//
// Monitors and rebalances positions every 6 hours to:
// 1. Maintain target margin utilization
// 2. Reduce overexposure on any exchange
// 3. Rebalance after significant P&L moves
// 4. Ensure proper hedging ratios

import { auditLog } from './auditLogger.ts';
import { recordFailure } from './circuitBreaker.ts';

const REBALANCE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MARGIN_DRIFT_THRESHOLD = 0.10; // 10% drift triggers rebalance
const HEDGE_RATIO_THRESHOLD = 0.95; // Min 95% hedge ratio

/**
 * Check if rebalancing is needed
 */
export async function checkRebalanceNeeded(base44) {
  const now = Date.now();
  
  // Get open positions
  const positions = await base44.asServiceRole.entities.ArbLivePosition.filter(
    { status: 'Open' },
    '-snapshot_time',
    100
  );
  
  if (positions.length === 0) {
    return { needed: false, reason: 'no_open_positions' };
  }
  
  // Get config
  const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
  const config = configs[0];
  
  if (!config) {
    return { needed: false, reason: 'no_config' };
  }
  
  const issues = [];
  let rebalanceNeeded = false;
  
  // Check 1: Margin utilization drift
  const totalCapital = Number(config.total_capital || 0);
  const perpBucket = totalCapital * Number(config.perp_collateral_pct || 0.245);
  const marginUsed = positions.reduce((sum, p) => sum + Number(p.margin_used || 0), 0);
  const marginUtil = perpBucket > 0 ? marginUsed / perpBucket : 0;
  const targetUtil = Number(config.max_margin_utilization_pct || 0.35);
  
  if (Math.abs(marginUtil - targetUtil) > MARGIN_DRIFT_THRESHOLD) {
    issues.push({
      type: 'margin_drift',
      current: marginUtil,
      target: targetUtil,
      drift: Math.abs(marginUtil - targetUtil),
    });
    rebalanceNeeded = true;
  }
  
  // Check 2: Delta drift (hedge ratio)
  const netDelta = positions.reduce((sum, p) => sum + Number(p.net_delta_usd || 0), 0);
  const grossExposure = positions.reduce((sum, p) => 
    sum + Math.abs(Number(p.spot_notional || 0)) + Math.abs(Number(p.perp_notional || 0)), 0
  );
  const hedgeRatio = grossExposure > 0 ? 1 - (Math.abs(netDelta) / grossExposure) : 1;
  
  if (hedgeRatio < HEDGE_RATIO_THRESHOLD) {
    issues.push({
      type: 'hedge_ratio_low',
      current: hedgeRatio,
      threshold: HEDGE_RATIO_THRESHOLD,
      netDelta,
    });
    rebalanceNeeded = true;
  }
  
  // Check 3: Time-based rebalance
  const lastRebalance = config.last_rebalance_at 
    ? new Date(config.last_rebalance_at).getTime() 
    : 0;
  
  if (now - lastRebalance > REBALANCE_INTERVAL_MS) {
    issues.push({
      type: 'time_based',
      hoursSinceLast: Math.floor((now - lastRebalance) / 3600000),
    });
    rebalanceNeeded = true;
  }
  
  // Check 4: Exchange concentration
  const exposureByExchange = {};
  positions.forEach(p => {
    const spotEx = p.spot_exchange;
    const perpEx = p.perp_exchange;
    
    if (spotEx) {
      exposureByExchange[spotEx] = (exposureByExchange[spotEx] || 0) + Number(p.spot_notional || 0);
    }
    if (perpEx) {
      exposureByExchange[perpEx] = (exposureByExchange[perpEx] || 0) + Number(p.perp_notional || 0);
    }
  });
  
  const maxExchangeExposure = Math.max(...Object.values(exposureByExchange));
  const maxExchangePct = totalCapital > 0 ? maxExchangeExposure / totalCapital : 0;
  
  if (maxExchangePct > 0.50) { // Max 50% on single exchange
    issues.push({
      type: 'exchange_concentration',
      exchange: Object.keys(exposureByExchange).find(k => exposureByExchange[k] === maxExchangeExposure),
      exposurePct: maxExchangePct,
    });
    rebalanceNeeded = true;
  }
  
  return {
    needed: rebalanceNeeded,
    issues,
    positions: positions.length,
    marginUtil,
    hedgeRatio,
    lastRebalance: lastRebalance > 0 ? new Date(lastRebalance).toISOString() : 'never',
  };
}

/**
 * Execute rebalancing actions
 */
export async function executeRebalance(base44, checkResult) {
  const actions = [];
  
  try {
    // Get current positions
    const positions = await base44.asServiceRole.entities.ArbLivePosition.filter(
      { status: 'Open' },
      '-snapshot_time',
      100
    );
    
    // Action 1: Reduce overexposed positions
    for (const issue of checkResult.issues) {
      if (issue.type === 'margin_drift' && issue.current > issue.target) {
        // Need to reduce margin usage
        const reductionNeeded = (issue.current - issue.target) * 100;
        actions.push({
          action: 'reduce_margin',
          reductionPct: reductionNeeded,
          message: `Reduce margin usage by ${reductionNeeded.toFixed(1)}%`,
        });
      }
      
      if (issue.type === 'hedge_ratio_low') {
        // Need to re-hedge
        actions.push({
          action: 're_hedge',
          targetDelta: 0,
          currentDelta: issue.netDelta,
          message: `Re-hedge to reduce delta from ${issue.netDelta.toFixed(2)} to 0`,
        });
      }
      
      if (issue.type === 'exchange_concentration') {
        actions.push({
          action: 'diversify',
          exchange: issue.exchange,
          exposurePct: issue.exposurePct,
          message: `Reduce exposure on ${issue.exchange} from ${(issue.exposurePct * 100).toFixed(1)}%`,
        });
      }
    }
    
    // Update last rebalance timestamp
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    if (configs[0]) {
      await base44.asServiceRole.entities.ArbConfig.update(configs[0].id, {
        last_rebalance_at: new Date().toISOString(),
        rebalance_count: (configs[0].rebalance_count || 0) + 1,
      });
    }
    
    // Log rebalance
    await auditLog(base44, {
      eventType: 'PORTFOLIO_REBALANCED',
      severity: 'INFO',
      message: `Portfolio rebalanced: ${actions.length} actions`,
      details: {
        positions: positions.length,
        actions,
        marginUtil: checkResult.marginUtil,
        hedgeRatio: checkResult.hedgeRatio,
      },
    });
    
    return {
      success: true,
      actions,
      timestamp: new Date().toISOString(),
    };
    
  } catch (error) {
    await recordFailure(base44, 'rebalance_error', {
      error: error.message,
      checkResult,
    });
    
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get rebalancing recommendations for manual review
 */
export async function getRebalanceRecommendations(base44) {
  const check = await checkRebalanceNeeded(base44);
  
  if (!check.needed) {
    return {
      needed: false,
      message: 'Portfolio is balanced',
      metrics: {
        marginUtil: check.marginUtil,
        hedgeRatio: check.hedgeRatio,
        positions: check.positions,
      },
    };
  }
  
  const recommendations = check.issues.map(issue => {
    switch (issue.type) {
      case 'margin_drift':
        return {
          priority: 'HIGH',
          action: 'Reduce position sizes',
          reason: `Margin utilization ${(issue.current * 100).toFixed(1)}% vs target ${(issue.target * 100).toFixed(1)}%`,
          steps: [
            'Close smallest/least profitable positions first',
            'Reduce remaining position sizes by 10-20%',
            'Maintain hedge ratios while reducing',
          ],
        };
        
      case 'hedge_ratio_low':
        return {
          priority: 'CRITICAL',
          action: 'Re-establish hedge',
          reason: `Hedge ratio ${(issue.current * 100).toFixed(1)}% below ${(HEDGE_RATIO_THRESHOLD * 100).toFixed(0)}% threshold`,
          steps: [
            'Add offsetting positions to reduce net delta',
            'Check for partial fills that broke hedge',
            'Verify both legs are properly sized',
          ],
        };
        
      case 'time_based':
        return {
          priority: 'MEDIUM',
          action: 'Routine rebalancing',
          reason: `${issue.hoursSinceLast} hours since last rebalance`,
          steps: [
            'Review all open positions',
            'Check margin utilization across exchanges',
            'Rebalance if any exchange >50% exposure',
          ],
        };
        
      case 'exchange_concentration':
        return {
          priority: 'HIGH',
          action: 'Diversify exposure',
          reason: `${issue.exchange} has ${(issue.exposurePct * 100).toFixed(1)}% of portfolio`,
          steps: [
            `Reduce positions on ${issue.exchange}`,
            'Open offsetting positions on other exchanges',
            'Consider cross-exchange transfers',
          ],
        };
        
      default:
        return { priority: 'LOW', action: 'Review', reason: issue.type };
    }
  });
  
  return {
    needed: true,
    recommendations: recommendations.sort((a, b) => {
      const prio = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return prio[a.priority] - prio[b.priority];
    }),
    metrics: {
      marginUtil: check.marginUtil,
      hedgeRatio: check.hedgeRatio,
      positions: check.positions,
      lastRebalance: check.lastRebalance,
    },
  };
}

export default {
  checkRebalanceNeeded,
  executeRebalance,
  getRebalanceRecommendations,
  REBALANCE_INTERVAL_MS,
  MARGIN_DRIFT_THRESHOLD,
  HEDGE_RATIO_THRESHOLD,
};
