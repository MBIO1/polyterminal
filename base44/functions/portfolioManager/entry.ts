// Portfolio Management Orchestrator
// 
// Runs all portfolio management functions on schedule:
// 1. Rebalancing (every 6 hours)
// 2. Profit compounding (daily)
// 3. Correlation monitoring (continuous)
// 4. Position sizing optimization

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { checkRebalanceNeeded, executeRebalance } from '../lib/rebalancer.ts';
import { checkCompounding, executeCompounding } from '../lib/profitCompounding.ts';
import { monitorAllCorrelations } from '../lib/correlationMonitor.ts';
import { auditLog } from '../lib/auditLogger.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Auth check
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const results = {
      timestamp: new Date().toISOString(),
      actions: [],
    };
    
    // 1. Check Correlation Health
    console.log('[PortfolioManager] Checking correlations...');
    const correlationCheck = await monitorAllCorrelations(base44);
    results.correlation = {
      status: correlationCheck.overall_status,
      canTrade: correlationCheck.can_trade,
      pairs: correlationCheck.pairs_monitored,
      critical: correlationCheck.critical_count,
    };
    
    if (!correlationCheck.can_trade) {
      results.actions.push({
        type: 'trading_halted',
        reason: 'correlation_breakdown',
        criticalPairs: correlationCheck.pairs.filter(p => p.status === 'critical'),
      });
    }
    
    // 2. Check Rebalancing
    console.log('[PortfolioManager] Checking rebalancing...');
    const rebalanceCheck = await checkRebalanceNeeded(base44);
    results.rebalance = {
      needed: rebalanceCheck.needed,
      marginUtil: rebalanceCheck.marginUtil,
      hedgeRatio: rebalanceCheck.hedgeRatio,
    };
    
    if (rebalanceCheck.needed) {
      const rebalanceResult = await executeRebalance(base44, rebalanceCheck);
      results.actions.push({
        type: 'rebalance',
        success: rebalanceResult.success,
        actions: rebalanceResult.actions,
      });
    }
    
    // 3. Check Profit Compounding
    console.log('[PortfolioManager] Checking compounding...');
    const compoundCheck = await checkCompounding(base44);
    results.compounding = {
      shouldCompound: compoundCheck.shouldCompound,
      profit: compoundCheck.profit,
    };
    
    if (compoundCheck.shouldCompound) {
      const compoundResult = await executeCompounding(base44, compoundCheck);
      results.actions.push({
        type: 'compounding',
        success: compoundResult.success,
        amount: compoundCheck.compoundAmount,
        newCapital: compoundResult.newCapital,
      });
    }
    
    // 4. Get overall stats
    const { getCompoundingStats } = await import('../lib/profitCompounding.ts');
    const stats = await getCompoundingStats(base44);
    results.portfolio = {
      currentCapital: stats.currentCapital,
      totalProfit: stats.totalProfit,
      totalReturn: stats.totalReturn,
      compoundedProfits: stats.compoundedProfits,
    };
    
    // Log summary
    await auditLog(base44, {
      eventType: 'PORTFOLIO_MANAGEMENT_RUN',
      severity: 'INFO',
      message: `Portfolio management executed: ${results.actions.length} actions`,
      details: results,
      userId: user.id,
    });
    
    return Response.json({
      ok: true,
      ...results,
    });
    
  } catch (error) {
    console.error('[PortfolioManager] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
