/**
 * Enhanced Trading Math and Risk Models
 * 
 * Improved slippage calculation with volatility adjustment and safety checks.
 */

/**
 * Calculate volatility-adjusted slippage
 */
export function calculateVolatilityAdjustedSlippage(
  sizeUsd,
  fillableUsd,
  volatility24h = 0.02, // Default 2% daily volatility
  profileName = 'Conservative',
  marketConditions = 'normal'
) {
  if (!fillableUsd || fillableUsd <= 0) {
    return { slippageBps: 50, warning: 'No liquidity data available' };
  }

  // Base slippage from depth consumption
  const depthRatio = sizeUsd / fillableUsd;
  let baseSlippage = Math.min(15, depthRatio * 25);

  // Volatility multiplier (higher vol = higher slippage)
  // Using annualized volatility approximation
  const volMultiplier = 1 + (volatility24h * 5); // 2% vol = 1.1x multiplier
  baseSlippage *= volMultiplier;

  // Market condition adjustments
  const conditionMultipliers = {
    normal: 1.0,
    volatile: 1.5,
    stressed: 2.0,
    extreme: 3.0,
  };
  baseSlippage *= conditionMultipliers[marketConditions] || 1.0;

  // Profile adjustments
  let profileMultiplier = 1.0;
  let maxSlippageCap = 20; // bps

  switch (profileName) {
    case 'Aggressive':
      profileMultiplier = 1.3;
      maxSlippageCap = 35;
      break;
    case 'Conservative':
      profileMultiplier = 1.0;
      maxSlippageCap = 20;
      break;
    case 'UltraConservative':
      profileMultiplier = 0.8;
      maxSlippageCap = 15;
      break;
    default:
      profileMultiplier = 1.0;
      maxSlippageCap = 20;
  }

  baseSlippage *= profileMultiplier;

  // Hard caps per asset size
  if (sizeUsd > 100000) {
    maxSlippageCap += 5; // Larger trades need more slippage allowance
  }

  // Apply cap
  const finalSlippage = Math.min(baseSlippage, maxSlippageCap);

  return {
    slippageBps: Math.round(finalSlippage * 100) / 100,
    baseSlippage: Math.round(baseSlippage * 100) / 100,
    components: {
      depth: Math.round(depthRatio * 25 * 100) / 100,
      volatility: Math.round((volMultiplier - 1) * baseSlippage * 100) / 100,
      marketCondition: Math.round((conditionMultipliers[marketConditions] - 1) * baseSlippage * 100) / 100,
    },
    warning: finalSlippage >= maxSlippageCap ? 'Slippage at maximum cap' : null,
  };
}

/**
 * Calculate maximum safe position size based on liquidity
 */
export function calculateSafePositionSize(fillableUsd, maxSlippageBps = 20) {
  // Conservative: use max 20% of available liquidity
  const liquidityLimit = fillableUsd * 0.20;
  
  // Slippage-based limit: size that would cause maxSlippageBps
  // Assuming linear relationship: slippage = (size/fillable) * 25 bps
  const slippageLimit = (maxSlippageBps / 25) * fillableUsd;
  
  return Math.min(liquidityLimit, slippageLimit);
}

/**
 * Validate that slippage is within acceptable bounds
 */
export function validateSlippage(slippageBps, maxAllowedBps = 30) {
  if (slippageBps > maxAllowedBps) {
    return {
      valid: false,
      error: `Slippage ${slippageBps.toFixed(2)} bps exceeds maximum ${maxAllowedBps} bps`,
      recommendation: 'Reduce position size or wait for better liquidity',
    };
  }

  if (slippageBps > maxAllowedBps * 0.8) {
    return {
      valid: true,
      warning: `Slippage ${slippageBps.toFixed(2)} bps is near maximum threshold`,
    };
  }

  return { valid: true };
}

/**
 * Calculate price impact from order size
 */
export function calculatePriceImpact(orderSizeUsd, availableLiquidityUsd, side = 'buy') {
  if (!availableLiquidityUsd || availableLiquidityUsd <= 0) {
    return { impact: 1.0, warning: 'No liquidity data' };
  }

  const ratio = orderSizeUsd / availableLiquidityUsd;
  
  // Square root model for price impact
  const impact = Math.sqrt(ratio) * 0.01; // 1% base impact

  // Side adjustment (selling usually has higher impact)
  const sideMultiplier = side === 'sell' ? 1.2 : 1.0;

  return {
    impact: Math.min(impact * sideMultiplier, 0.5), // Cap at 50%
    ratio,
    warning: impact > 0.02 ? 'High price impact expected' : null,
  };
}

/**
 * Estimate volatility from recent price data
 */
export function estimateVolatility(priceHistory) {
  if (!priceHistory || priceHistory.length < 2) {
    return 0.02; // Default 2%
  }

  const returns = [];
  for (let i = 1; i < priceHistory.length; i++) {
    returns.push(Math.log(priceHistory[i] / priceHistory[i - 1]));
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Annualize (assuming hourly data)
  return stdDev * Math.sqrt(24 * 365);
}

/**
 * Calculate dynamic minimum edge based on market conditions
 */
export function calculateDynamicMinEdge(
  baseMinEdgeBps,
  volatility24h,
  marketConditions = 'normal'
) {
  const volAdjustment = Math.max(0, (volatility24h - 0.02) * 100); // 1 bps per 1% vol above 2%
  
  const conditionMultipliers = {
    normal: 1.0,
    volatile: 1.3,
    stressed: 1.6,
    extreme: 2.0,
  };

  const adjusted = (baseMinEdgeBps + volAdjustment) * (conditionMultipliers[marketConditions] || 1.0);
  
  return Math.round(adjusted * 100) / 100;
}

/**
 * Validate trade parameters
 */
export function validateTradeParams(params) {
  const errors = [];
  const warnings = [];

  // Size validation
  if (!params.sizeUsd || params.sizeUsd <= 0) {
    errors.push('Trade size must be positive');
  } else if (params.sizeUsd < 10) {
    warnings.push('Trade size is very small (< $10)');
  } else if (params.sizeUsd > 1000000) {
    errors.push('Trade size exceeds maximum ($1M)');
  }

  // Price validation
  if (!params.buyPrice || params.buyPrice <= 0) {
    errors.push('Invalid buy price');
  }
  if (!params.sellPrice || params.sellPrice <= 0) {
    errors.push('Invalid sell price');
  }
  if (params.sellPrice <= params.buyPrice) {
    errors.push('Sell price must be greater than buy price');
  }

  // Spread validation
  const spread = ((params.sellPrice - params.buyPrice) / params.buyPrice) * 10000;
  if (spread < 0) {
    errors.push('Negative spread detected');
  } else if (spread < 5) {
    warnings.push('Very tight spread (< 5 bps)');
  }

  // Liquidity validation
  if (params.fillableUsd && params.sizeUsd > params.fillableUsd * 0.5) {
    errors.push('Trade size exceeds 50% of available liquidity');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    spreadBps: Math.round(spread * 100) / 100,
  };
}

export default {
  calculateVolatilityAdjustedSlippage,
  calculateSafePositionSize,
  validateSlippage,
  calculatePriceImpact,
  estimateVolatility,
  calculateDynamicMinEdge,
  validateTradeParams,
};
