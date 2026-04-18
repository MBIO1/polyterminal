/**
 * Shared backtest engine — used by Backtester manual tab and Optimizer tab.
 * Replays BotTrade history under a given parameter set and returns all metrics.
 */

export function runBacktest(trades, params) {
  const {
    edge_threshold = 5,
    lag_threshold = 3,
    confidence_threshold = 80,
    kelly_fraction = 0.5,
    max_position_pct = 8,
    starting_balance = 1000,
  } = params;

  const eligible = trades
    .filter(t =>
      t.outcome !== 'pending' &&
      t.outcome !== 'cancelled' &&
      (t.edge_at_entry || 0) >= edge_threshold &&
      (t.confidence_at_entry || 0) >= confidence_threshold
    )
    .sort((a, b) => new Date(a.created_date) - new Date(b.created_date));

  let portfolio = starting_balance;
  let maxPortfolio = starting_balance;
  let maxDrawdown = 0;
  const equity = [];
  let wins = 0, losses = 0, totalPnl = 0;
  const dailyMap = {};
  const dailyReturns = [];

  for (const trade of eligible) {
    const edge = trade.edge_at_entry || 0;
    const price = trade.entry_price || 0.5;
    const b = price > 0 && price < 1 ? (1 - price) / price : 1;
    const p = Math.min(0.99, price + edge / 100);
    const q = 1 - p;
    const k = Math.max(0, (b * p - q) / b);
    const sized = k * kelly_fraction;
    const sizeUsdc = Math.min(sized * portfolio, portfolio * max_position_pct / 100);

    if (sizeUsdc < 0.5) continue;

    const pnl = trade.outcome === 'win'
      ? sizeUsdc * ((1 - price) / price)
      : -sizeUsdc;

    const returnPct = pnl / portfolio;
    dailyReturns.push(returnPct);

    portfolio += pnl;
    totalPnl += pnl;
    if (trade.outcome === 'win') wins++; else losses++;

    maxPortfolio = Math.max(maxPortfolio, portfolio);
    const dd = maxPortfolio > 0 ? ((maxPortfolio - portfolio) / maxPortfolio) * 100 : 0;
    maxDrawdown = Math.max(maxDrawdown, dd);

    const day = trade.created_date?.slice(0, 10);
    if (!dailyMap[day]) dailyMap[day] = 0;
    dailyMap[day] += pnl;

    equity.push({
      label: trade.created_date?.slice(5, 10),
      portfolio: Number(portfolio.toFixed(2)),
      pnl: Number(pnl.toFixed(3)),
    });
  }

  const total = wins + losses;
  const winRate = total > 0 ? (wins / total * 100) : 0;

  // Sharpe ratio: mean return / std dev of returns (annualised factor omitted for relative comparison)
  const sharpe = computeSharpe(dailyReturns);

  const dailyPnl = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pnl]) => ({ date: date.slice(5), pnl: Number(pnl.toFixed(2)) }));

  return {
    trades: total,
    wins,
    losses,
    winRate: Number(winRate.toFixed(1)),
    totalPnl: Number(totalPnl.toFixed(2)),
    finalPortfolio: Number(portfolio.toFixed(2)),
    maxDrawdown: Number(maxDrawdown.toFixed(1)),
    sharpe: Number(sharpe.toFixed(3)),
    equity,
    dailyPnl,
    params: { edge_threshold, lag_threshold, confidence_threshold, kelly_fraction, max_position_pct },
  };
}

function computeSharpe(returns) {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return mean / std; // raw ratio — used purely for relative ranking
}