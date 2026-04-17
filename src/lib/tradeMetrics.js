/**
 * Shared trade metrics calculations used by Dashboard and Analytics pages.
 */

/**
 * Compute all advanced performance metrics from a list of BotTrade records.
 * @param {Array} trades - array of BotTrade records
 * @param {number} startingBalance - initial capital (default 1000)
 */
export function computeMetrics(trades, startingBalance = 1000) {
  const resolved = trades.filter(t => t.outcome === 'win' || t.outcome === 'loss');
  const wins     = resolved.filter(t => t.outcome === 'win');
  const losses   = resolved.filter(t => t.outcome === 'loss');
  const pending  = trades.filter(t => t.outcome === 'pending');

  // ── Realized vs Unrealized P&L ─────────────────────────────────────────────
  const realizedPnl   = resolved.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
  // Unrealized: pending trades modelled at current entry price (mid-mark = 50¢)
  // Best estimate: assume current mark ≈ entry (no net gain/loss yet)
  const unrealizedPnl = pending.reduce((s, t) => {
    // Mark-to-market at 0.5 (midpoint) vs entry
    const entry = t.entry_price || 0.5;
    const markPnl = (0.5 - entry) * (t.shares || 0);
    return s + markPnl;
  }, 0);
  const totalPnl = realizedPnl + unrealizedPnl;
  const portfolioValue = startingBalance + totalPnl;

  // ── Win Rate overall ───────────────────────────────────────────────────────
  const winRate = resolved.length > 0 ? (wins.length / resolved.length) * 100 : 0;

  // ── Win Rate by mode ───────────────────────────────────────────────────────
  const paperResolved = resolved.filter(t => t.mode === 'paper' || !t.mode);
  const liveResolved  = resolved.filter(t => t.mode === 'live');
  const paperWins     = paperResolved.filter(t => t.outcome === 'win');
  const liveWins      = liveResolved.filter(t => t.outcome === 'win');
  const paperWinRate  = paperResolved.length > 0 ? (paperWins.length / paperResolved.length) * 100 : null;
  const liveWinRate   = liveResolved.length > 0  ? (liveWins.length  / liveResolved.length)  * 100 : null;

  // ── Profit Factor ──────────────────────────────────────────────────────────
  const grossWin  = wins.reduce((s, t)   => s + (t.pnl_usdc || 0), 0);
  const grossLoss = losses.reduce((s, t) => s + Math.abs(t.pnl_usdc || 0), 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : wins.length > 0 ? 999 : 0;

  // ── Avg P&L ────────────────────────────────────────────────────────────────
  const avgPnl = resolved.length > 0 ? realizedPnl / resolved.length : 0;

  // ── Equity curve (chronological) ──────────────────────────────────────────
  const sorted = [...trades].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
  let cum = 0;
  let peak = 0;
  let maxDrawdown = 0;          // worst peak-to-trough ever (negative %)
  let trailingDrawdown = 0;     // current drawdown from most recent peak (negative %)

  const equityCurve  = [];
  const drawdownSeries = [];

  sorted.forEach((t, i) => {
    cum += t.pnl_usdc || 0;
    if (cum > peak) peak = cum;
    const dd = peak > 0 ? ((peak - cum) / peak) * 100 : 0;
    if (-dd < maxDrawdown) maxDrawdown = -dd;
    const label = t.created_date?.slice(5, 10) || String(i + 1);
    equityCurve.push({ idx: i + 1, label, cumPnl: Number(cum.toFixed(2)) });
    drawdownSeries.push({ idx: i + 1, label, drawdown: Number((-dd).toFixed(2)) });
  });

  // Trailing drawdown = current drawdown from peak (last point in series)
  trailingDrawdown = drawdownSeries.length > 0 ? drawdownSeries[drawdownSeries.length - 1].drawdown : 0;

  // ── Sharpe Ratio (annualized, assuming ~daily returns) ─────────────────────
  // Group realized PnL by day, then compute mean/std
  const dailyMap = {};
  resolved.forEach(t => {
    const day = t.created_date?.slice(0, 10);
    if (!day) return;
    dailyMap[day] = (dailyMap[day] || 0) + (t.pnl_usdc || 0);
  });
  const dailyReturns = Object.values(dailyMap);
  let sharpeRatio = 0;
  if (dailyReturns.length >= 2) {
    const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (dailyReturns.length - 1);
    const std = Math.sqrt(variance);
    // Risk-free rate ≈ 0 for short-term paper trading
    sharpeRatio = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }

  return {
    // Counts
    totalTrades:  trades.length,
    resolvedCount: resolved.length,
    pendingCount:  pending.length,
    // P&L
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    portfolioValue,
    avgPnl,
    // Win rates
    winRate,
    paperWinRate,
    liveWinRate,
    paperCount: paperResolved.length,
    liveCount:  liveResolved.length,
    // Risk
    profitFactor,
    maxDrawdown,            // most negative value (e.g. -18.5 means 18.5% drawdown)
    trailingDrawdown,       // current drawdown from peak (negative)
    sharpeRatio,
    // Series for charts
    equityCurve,
    drawdownSeries,
  };
}