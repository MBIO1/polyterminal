// Polymarket Latency Arbitrage Bot Engine
// Simulates the Python bot logic in the browser for paper trading

import { base44 } from '@/api/base44Client';

// ── Kelly Criterion (half-Kelly) ──────────────────────────────────────────────
export function halfKelly(edge, price, portfolioValue, maxPosPct = 0.08) {
  // edge = decimal edge (e.g. 0.07 for 7%)
  // price = probability (e.g. 0.45)
  const b = (1 - price) / price; // odds
  const p = price + edge;         // adjusted win prob
  const q = 1 - p;
  const fullKelly = (b * p - q) / b;
  const halfK = fullKelly / 2;
  const maxSize = portfolioValue * maxPosPct;
  const kellySize = Math.max(1, Math.min(halfK * portfolioValue, maxSize));
  return Number(kellySize.toFixed(2));
}

// ── Implied probability from Binance price movement ──────────────────────────
export function cexImpliedProb(asset, contractType, currentPrice, prevPrice, volatility = 0.02) {
  // Very simplified: use recent momentum + vol to estimate up/down prob
  const priceChange = (currentPrice - prevPrice) / prevPrice;
  const momentum = priceChange / volatility; // normalized

  // Sigmoid to convert momentum to probability
  const rawProb = 1 / (1 + Math.exp(-momentum * 3));

  if (contractType.includes('up')) return rawProb;
  return 1 - rawProb;
}

// ── Detect arbitrage opportunity ─────────────────────────────────────────────
export function detectOpportunity(polyPrice, cexProb, lagThreshold = 3, edgeThreshold = 5) {
  const lag = Math.abs(polyPrice - cexProb) * 100; // in pct points
  const edge = lag; // simplified: lag IS the edge

  if (lag < lagThreshold) return null;
  if (edge < edgeThreshold) return null;

  // Confidence: based on lag magnitude and consistency
  const rawConfidence = Math.min(99, 60 + lag * 3);

  return {
    lag_pct: lag,
    edge_pct: edge,
    confidence_score: rawConfidence,
    recommended_side: cexProb > polyPrice ? 'yes' : 'no',
  };
}

// ── Format USDC ───────────────────────────────────────────────────────────────
export function fmtUSDC(n) {
  return `$${Number(n).toFixed(2)}`;
}

export function fmtPct(n) {
  return `${Number(n).toFixed(1)}%`;
}

// ── Win rate from trades ──────────────────────────────────────────────────────
export function calcStats(trades) {
  const settled = trades.filter(t => t.outcome === 'win' || t.outcome === 'loss');
  const wins = settled.filter(t => t.outcome === 'win').length;
  const winRate = settled.length > 0 ? (wins / settled.length) * 100 : 0;
  const totalPnl = trades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
  const grossProfit = trades.filter(t => (t.pnl_usdc || 0) > 0).reduce((s, t) => s + t.pnl_usdc, 0);
  const grossLoss = Math.abs(trades.filter(t => (t.pnl_usdc || 0) < 0).reduce((s, t) => s + t.pnl_usdc, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  return { winRate, totalPnl, profitFactor, totalTrades: settled.length, wins };
}

// ── Daily drawdown ────────────────────────────────────────────────────────────
export function calcDailyDrawdown(trades, startingBalance) {
  const today = new Date().toDateString();
  const todayTrades = trades.filter(t => t.created_date && new Date(t.created_date).toDateString() === today);
  const todayPnl = todayTrades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
  const drawdown = startingBalance > 0 ? (Math.abs(Math.min(0, todayPnl)) / startingBalance) * 100 : 0;
  return { drawdown, todayPnl };
}