// Enhanced Position Sizing Module with Liquidity and Volatility Adjustments
//
// Implements professional arbitrage position sizing:
// 1. Liquidity-based sizing (max 20% of order book)
// 2. Volatility-adjusted sizing (reduce in high vol)
// 3. Kelly Criterion sizing (Half-Kelly)
// 4. Market regime detection

import { auditLog } from './auditLogger.ts';

// Configuration constants
const MAX_LIQUIDITY_PCT = 0.20; // Max 20% of order book depth
const VOLATILITY_THRESHOLD_LOW = 0.02; // 2% daily vol
const VOLATILITY_THRESHOLD_HIGH = 0.05; // 5% daily vol
const VOLATILITY_THRESHOLD_EXTREME = 0.10; // 10% daily vol

// Volatility regime multipliers
const VOLATILITY_MULTIPLIERS = {
  low: 1.0,      // Normal sizing
  medium: 0.70,  // Reduce 30%
  high: 0.50,    // Reduce 50%
  extreme: 0.25, // Reduce 75%
};

/**
 * Calculate liquidity-based maximum position size
 * Never exceed 20% of available order book depth
 */
export function calculateLiquidityCap(fillableUsd, currentSize) {
  const maxFromLiquidity = fillableUsd * MAX_LIQUIDITY_PCT;
  
  return {
    maxSize: maxFromLiquidity,
    isLimited: currentSize > maxFromLiquidity,
    liquidityUtilization: currentSize / fillableUsd,
    warning: currentSize > maxFromLiquidity 
      ? `Position exceeds 20% liquidity limit (${(currentSize/fillableUsd*100).toFixed(1)}%)`
      : null,
  };
}

/**
 * Get volatility regime and adjustment multiplier
 */
export function getVolatilityRegime(dailyVolatility) {
  if (dailyVolatility >= VOLATILITY_THRESHOLD_EXTREME) {
    return { regime: 'extreme', multiplier: VOLATILITY_MULTIPLIERS.extreme };
  } else if (dailyVolatility >= VOLATILITY_THRESHOLD_HIGH) {
    return { regime: 'high', multiplier: VOLATILITY_MULTIPLIERS.high };
  } else if (dailyVolatility >= VOLATILITY_THRESHOLD_LOW) {
    return { regime: 'medium', multiplier: VOLATILITY_MULTIPLIERS.medium };
  }
  return { regime: 'low', multiplier: VOLATILITY_MULTIPLIERS.low };
}

/**
 * Calculate Half-Kelly position size
 * 
 * Kelly Formula: f* = (bp - q) / b
 * Where:
 * - f* = optimal fraction
 * - b = average win / average loss (odds)
 * - p = win probability
 * - q = loss probability (1-p)
 * 
 * We use Half-Kelly for reduced variance
 */
export function calculateKellySize(winRate, avgWinBps, avgLossBps, maxPositionUsd) {
  if (!winRate || !avgWinBps || !avgLossBps || avgLossBps === 0) {
    return { kellySize: maxPositionUsd, fraction: 1.0, usingDefault: true };
  }
  
  const b = avgWinBps / avgLossBps; // Odds
  const p = winRate;
  const q = 1 - p;
  
  // Full Kelly
  const fullKelly = (b * p - q) / b;
  
  // Half-Kelly (more conservative, reduces variance)
  const halfKelly = fullKelly / 2;
  
  // Cap between 0.1 and 1.0 (never go below 10% or above 100%)
  const cappedKelly = Math.max(0.1, Math.min(1.0, halfKelly));
  
  const kellySize = maxPositionUsd * cappedKelly;
  
  return {
    kellySize,
    fullKelly,
    halfKelly: cappedKelly,
    fraction: cappedKelly,
    usingDefault: false,
  };
}

/**
 * Calculate enhanced position size with all adjustments
 */
export async function calculateEnhancedPositionSize({
  baseSize,
  fillableUsd,
  volatility24h = 0.02,
  winRate = 0.65, // Default 65% win rate
  avgWinBps = 15,
  avgLossBps = 8,
  asset,
  base44,
}) {
  const adjustments = [];
  
  // 1. Base liquidity cap (20% max)
  const liquidityCap = calculateLiquidityCap(fillableUsd, baseSize);
  let finalSize = Math.min(baseSize, liquidityCap.maxSize);
  
  if (liquidityCap.isLimited) {
    adjustments.push(`liquidity_cap: ${liquidityCap.maxSize.toFixed(0)} USD (20% of book)`);
  }
  
  // 2. Volatility adjustment
  const volRegime = getVolatilityRegime(volatility24h);
  finalSize *= volRegime.multiplier;
  
  if (volRegime.regime !== 'low') {
    adjustments.push(`volatility_${volRegime.regime}: ${(volRegime.multiplier * 100).toFixed(0)}% size`);
  }
  
  // 3. Kelly Criterion sizing
  const kelly = calculateKellySize(winRate, avgWinBps, avgLossBps, finalSize);
  finalSize = kelly.kellySize;
  
  if (!kelly.usingDefault) {
    adjustments.push(`kelly_sizing: ${(kelly.fraction * 100).toFixed(1)}% (${(kelly.halfKelly * 100).toFixed(1)}% Half-Kelly)`);
  }
  
  // 4. Minimum size check
  if (finalSize < 10) {
    return {
      size: 0,
      shouldTrade: false,
      reason: 'Position size below minimum ($10)',
      adjustments,
    };
  }
  
  // Log the calculation
  if (base44) {
    await auditLog(base44, {
      eventType: 'POSITION_SIZE_CALCULATED',
      severity: 'DEBUG',
      message: `Enhanced position sizing for ${asset}`,
      details: {
        asset,
        baseSize,
        finalSize,
        liquidityCap: liquidityCap.maxSize,
        volatilityRegime: volRegime.regime,
        kellyFraction: kelly.fraction,
        adjustments,
      },
    });
  }
  
  return {
    size: Math.floor(finalSize),
    shouldTrade: true,
    baseSize,
    liquidityCap: liquidityCap.maxSize,
    volatilityRegime: volRegime.regime,
    volatilityMultiplier: volRegime.multiplier,
    kellyFraction: kelly.fraction,
    adjustments,
  };
}

/**
 * Estimate volatility from recent price data
 * In production, this would come from exchange API
 */
export function estimateVolatilityFromPrices(prices) {
  if (!prices || prices.length < 2) return 0.02; // Default 2%
  
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  // Annualize (assuming hourly data)
  return stdDev * Math.sqrt(24 * 365);
}

/**
 * Get asset-specific volatility estimate
 */
export function getAssetVolatilityEstimate(asset) {
  // Typical daily volatilities by asset
  const volatilities = {
    'BTC': 0.025,
    'ETH': 0.035,
    'SOL': 0.055,
    'Other': 0.065,
  };
  
  return volatilities[asset] || volatilities['Other'];
}

/**
 * Validate position against all risk limits
 */
export function validatePositionRisk(position, config) {
  const issues = [];
  
  // Check against max position size
  if (position.size > config.max_notional_usd) {
    issues.push(`Position ${position.size} exceeds max ${config.max_notional_usd}`);
  }
  
  // Check liquidity utilization
  if (position.liquidityUtilization > MAX_LIQUIDITY_PCT) {
    issues.push(`Liquidity utilization ${(position.liquidityUtilization * 100).toFixed(1)}% exceeds ${MAX_LIQUIDITY_PCT * 100}%`);
  }
  
  // Check portfolio heat (total exposure)
  const portfolioHeat = position.size / config.total_capital;
  if (portfolioHeat > 0.05) { // Max 5% per position
    issues.push(`Portfolio heat ${(portfolioHeat * 100).toFixed(1)}% exceeds 5%`);
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}

export default {
  calculateLiquidityCap,
  getVolatilityRegime,
  calculateKellySize,
  calculateEnhancedPositionSize,
  estimateVolatilityFromPrices,
  getAssetVolatilityEstimate,
  validatePositionRisk,
};
