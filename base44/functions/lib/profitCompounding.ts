// Profit Compounding Module
//
// Automatically compounds profits to grow portfolio:
// 1. Track daily/weekly profits
// 2. Compound 50-70% of profits back into trading capital
// 3. Withdraw 30-50% to safe storage
// 4. Adjust position sizes as capital grows

import { auditLog } from './auditLogger.ts';

const COMPOUND_RATIO = 0.70; // 70% compound, 30% reserve
const MIN_PROFIT_TO_COMPOUND = 100; // Minimum $100 profit
const COMPOUND_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // Daily

/**
 * Calculate profits for a time period
 */
export async function calculatePeriodProfits(base44, startDate, endDate) {
  // Get closed trades in period
  const trades = await base44.asServiceRole.entities.ArbTrade.filter(
    { 
      status: 'Closed',
      trade_date: { $gte: startDate, $lte: endDate },
    },
    '-exit_timestamp',
    1000
  );
  
  const totalPnl = trades.reduce((sum, t) => sum + Number(t.net_pnl || 0), 0);
  const winningTrades = trades.filter(t => Number(t.net_pnl || 0) > 0);
  const losingTrades = trades.filter(t => Number(t.net_pnl || 0) < 0);
  
  return {
    totalPnl,
    tradeCount: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: trades.length > 0 ? winningTrades.length / trades.length : 0,
    avgWin: winningTrades.length > 0 
      ? winningTrades.reduce((s, t) => s + Number(t.net_pnl || 0), 0) / winningTrades.length 
      : 0,
    avgLoss: losingTrades.length > 0 
      ? losingTrades.reduce((s, t) => s + Number(t.net_pnl || 0), 0) / losingTrades.length 
      : 0,
    startDate,
    endDate,
  };
}

/**
 * Check if compounding should occur
 */
export async function checkCompounding(base44) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  
  // Get config
  const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
  const config = configs[0];
  
  if (!config) {
    return { shouldCompound: false, reason: 'no_config' };
  }
  
  // Check last compound date
  const lastCompound = config.last_compound_at 
    ? new Date(config.last_compound_at).toISOString().slice(0, 10)
    : null;
  
  if (lastCompound === today) {
    return { shouldCompound: false, reason: 'already_compounded_today' };
  }
  
  // Calculate yesterday's profit
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  
  const profits = await calculatePeriodProfits(base44, yesterdayStr, yesterdayStr);
  
  if (profits.totalPnl <= 0) {
    return { 
      shouldCompound: false, 
      reason: 'no_profit_or_loss',
      profit: profits.totalPnl,
    };
  }
  
  if (profits.totalPnl < MIN_PROFIT_TO_COMPOUND) {
    return {
      shouldCompound: false,
      reason: 'profit_below_minimum',
      profit: profits.totalPnl,
      minimum: MIN_PROFIT_TO_COMPOUND,
    };
  }
  
  const compoundAmount = profits.totalPnl * COMPOUND_RATIO;
  const reserveAmount = profits.totalPnl * (1 - COMPOUND_RATIO);
  
  return {
    shouldCompound: true,
    profit: profits.totalPnl,
    compoundAmount,
    reserveAmount,
    compoundRatio: COMPOUND_RATIO,
    tradeStats: {
      count: profits.tradeCount,
      winRate: profits.winRate,
      avgWin: profits.avgWin,
      avgLoss: profits.avgLoss,
    },
  };
}

/**
 * Execute profit compounding
 */
export async function executeCompounding(base44, compoundCheck) {
  try {
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config = configs[0];
    
    if (!config) {
      throw new Error('No config found');
    }
    
    const currentCapital = Number(config.total_capital || 0);
    const newCapital = currentCapital + compoundCheck.compoundAmount;
    
    // Update config with new capital
    await base44.asServiceRole.entities.ArbConfig.update(config.id, {
      total_capital: newCapital,
      last_compound_at: new Date().toISOString(),
      compounded_profits_total: (config.compounded_profits_total || 0) + compoundCheck.compoundAmount,
      reserved_profits_total: (config.reserved_profits_total || 0) + compoundCheck.reserveAmount,
      compound_count: (config.compound_count || 0) + 1,
    });
    
    // Log compounding
    await auditLog(base44, {
      eventType: 'PROFITS_COMPOUNDED',
      severity: 'INFO',
      message: `Compounded $${compoundCheck.compoundAmount.toFixed(2)} of $${compoundCheck.profit.toFixed(2)} profit`,
      details: {
        profit: compoundCheck.profit,
        compoundAmount: compoundCheck.compoundAmount,
        reserveAmount: compoundCheck.reserveAmount,
        previousCapital: currentCapital,
        newCapital,
        tradeStats: compoundCheck.tradeStats,
      },
    });
    
    return {
      success: true,
      previousCapital: currentCapital,
      newCapital,
      compoundAmount: compoundCheck.compoundAmount,
      reserveAmount: compoundCheck.reserveAmount,
      timestamp: new Date().toISOString(),
    };
    
  } catch (error) {
    await auditLog(base44, {
      eventType: 'COMPOUNDING_ERROR',
      severity: 'ERROR',
      message: `Failed to compound profits: ${error.message}`,
      details: { error: error.message },
    });
    
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get compounding history and stats
 */
export async function getCompoundingStats(base44) {
  const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
  const config = configs[0];
  
  if (!config) {
    return { error: 'No config found' };
  }
  
  // Get all-time profits
  const allTrades = await base44.asServiceRole.entities.ArbTrade.filter(
    { status: 'Closed' },
    '-exit_timestamp',
    5000
  );
  
  const totalProfit = allTrades.reduce((sum, t) => sum + Number(t.net_pnl || 0), 0);
  const startingCapital = Number(config.total_capital || 0) - (config.compounded_profits_total || 0);
  const totalReturn = startingCapital > 0 ? (totalProfit / startingCapital) * 100 : 0;
  
  return {
    startingCapital,
    currentCapital: Number(config.total_capital || 0),
    totalProfit,
    totalReturn: totalReturn.toFixed(2) + '%',
    compoundedProfits: config.compounded_profits_total || 0,
    reservedProfits: config.reserved_profits_total || 0,
    compoundCount: config.compound_count || 0,
    lastCompound: config.last_compound_at,
    compoundRatio: COMPOUND_RATIO,
    projectedGrowth: {
      monthly: calculateProjectedGrowth(startingCapital, totalProfit, 30),
      yearly: calculateProjectedGrowth(startingCapital, totalProfit, 365),
    },
  };
}

/**
 * Calculate projected growth
 */
function calculateProjectedGrowth(startingCapital, totalProfit, days) {
  if (startingCapital <= 0 || totalProfit <= 0) return null;
  
  const dailyReturn = totalProfit / startingCapital / 30; // Assume 30 days of data
  const projectedMultiplier = Math.pow(1 + dailyReturn, days);
  const projectedCapital = startingCapital * projectedMultiplier;
  
  return {
    projectedCapital: Math.round(projectedCapital),
    growthMultiplier: projectedMultiplier.toFixed(2) + 'x',
    roi: ((projectedMultiplier - 1) * 100).toFixed(1) + '%',
  };
}

/**
 * Get daily profit report
 */
export async function getDailyProfitReport(base44, date = null) {
  const targetDate = date || new Date().toISOString().slice(0, 10);
  
  const profits = await calculatePeriodProfits(base44, targetDate, targetDate);
  
  return {
    date: targetDate,
    ...profits,
    compounded: profits.totalPnl > 0 ? profits.totalPnl * COMPOUND_RATIO : 0,
    reserved: profits.totalPnl > 0 ? profits.totalPnl * (1 - COMPOUND_RATIO) : 0,
  };
}

/**
 * Manual compounding trigger (for admin use)
 */
export async function manualCompound(base44, amount, ratio = COMPOUND_RATIO) {
  const compoundCheck = {
    shouldCompound: true,
    profit: amount,
    compoundAmount: amount * ratio,
    reserveAmount: amount * (1 - ratio),
    compoundRatio: ratio,
    tradeStats: { manual: true },
  };
  
  return await executeCompounding(base44, compoundCheck);
}

export default {
  calculatePeriodProfits,
  checkCompounding,
  executeCompounding,
  getCompoundingStats,
  getDailyProfitReport,
  manualCompound,
  COMPOUND_RATIO,
  MIN_PROFIT_TO_COMPOUND,
};
