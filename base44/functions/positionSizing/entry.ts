// Enhanced Position Sizing Module with Liquidity and Volatility Adjustments
//
// Implements professional arbitrage position sizing:
// 1. Liquidity-based sizing (max 20% of order book)
// 2. Volatility-adjusted sizing (reduce in high vol)
// 3. Kelly Criterion sizing (Half-Kelly)

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MAX_LIQUIDITY_PCT = 0.20;
const VOLATILITY_THRESHOLD_LOW = 0.02;
const VOLATILITY_THRESHOLD_HIGH = 0.05;
const VOLATILITY_THRESHOLD_EXTREME = 0.10;

const VOLATILITY_MULTIPLIERS = {
  low: 1.0,
  medium: 0.70,
  high: 0.50,
  extreme: 0.25,
};

const ASSET_VOLATILITIES = {
  'BTC': 0.025,
  'ETH': 0.035,
  'SOL': 0.055,
  'Other': 0.065,
};

function calculateLiquidityCap(fillableUsd, currentSize) {
  const maxFromLiquidity = fillableUsd * MAX_LIQUIDITY_PCT;
  return {
    maxSize: maxFromLiquidity,
    isLimited: currentSize > maxFromLiquidity,
    liquidityUtilization: currentSize / fillableUsd,
    warning: currentSize > maxFromLiquidity
      ? `Position exceeds 20% liquidity limit (${(currentSize / fillableUsd * 100).toFixed(1)}%)`
      : null,
  };
}

function getVolatilityRegime(dailyVolatility) {
  if (dailyVolatility >= VOLATILITY_THRESHOLD_EXTREME) return { regime: 'extreme', multiplier: VOLATILITY_MULTIPLIERS.extreme };
  if (dailyVolatility >= VOLATILITY_THRESHOLD_HIGH)    return { regime: 'high',    multiplier: VOLATILITY_MULTIPLIERS.high };
  if (dailyVolatility >= VOLATILITY_THRESHOLD_LOW)     return { regime: 'medium',  multiplier: VOLATILITY_MULTIPLIERS.medium };
  return { regime: 'low', multiplier: VOLATILITY_MULTIPLIERS.low };
}

function calculateKellySize(winRate, avgWinBps, avgLossBps, maxPositionUsd) {
  if (!winRate || !avgWinBps || !avgLossBps || avgLossBps === 0) {
    return { kellySize: maxPositionUsd, fraction: 1.0, usingDefault: true };
  }
  const b = avgWinBps / avgLossBps;
  const p = winRate;
  const q = 1 - p;
  const fullKelly = (b * p - q) / b;
  const halfKelly = fullKelly / 2;
  const cappedKelly = Math.max(0.1, Math.min(1.0, halfKelly));
  return {
    kellySize: maxPositionUsd * cappedKelly,
    fullKelly,
    halfKelly: cappedKelly,
    fraction: cappedKelly,
    usingDefault: false,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const {
      baseSize,
      fillableUsd,
      asset = 'BTC',
      winRate = 0.65,
      avgWinBps = 15,
      avgLossBps = 8,
    } = body;

    if (!baseSize || !fillableUsd) {
      return Response.json({ error: 'baseSize and fillableUsd are required' }, { status: 400 });
    }

    const volatility24h = ASSET_VOLATILITIES[asset] || ASSET_VOLATILITIES['Other'];
    const adjustments = [];

    // 1. Liquidity cap (20% max)
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

    // 3. Kelly Criterion
    const kelly = calculateKellySize(winRate, avgWinBps, avgLossBps, finalSize);
    finalSize = kelly.kellySize;
    if (!kelly.usingDefault) {
      adjustments.push(`kelly_sizing: ${(kelly.fraction * 100).toFixed(1)}% Half-Kelly`);
    }

    if (finalSize < 10) {
      return Response.json({
        size: 0,
        shouldTrade: false,
        reason: 'Position size below minimum ($10)',
        adjustments,
      });
    }

    return Response.json({
      size: Math.floor(finalSize),
      shouldTrade: true,
      baseSize,
      liquidityCap: liquidityCap.maxSize,
      volatilityRegime: volRegime.regime,
      volatilityMultiplier: volRegime.multiplier,
      kellyFraction: kelly.fraction,
      adjustments,
    });

  } catch (error) {
    console.error('[positionSizing] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});