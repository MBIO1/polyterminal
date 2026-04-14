import React from 'react';
import { BarChart2, Target, TrendingUp, Award } from 'lucide-react';

const MetricBox = ({ label, value, sub, color = 'text-foreground' }) => (
  <div className="rounded-lg bg-secondary/50 border border-border/50 p-3">
    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
    <p className={`text-lg font-mono font-bold ${color}`}>{value}</p>
    {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
  </div>
);

export default function PerformanceMetrics({ stats, portfolioValue, startingBalance, paperTrades }) {
  const totalReturn = startingBalance > 0 ? ((portfolioValue - startingBalance) / startingBalance) * 100 : 0;
  const avgEdge = paperTrades?.length > 0
    ? paperTrades.reduce((s, t) => s + (t.edge_at_entry || 0), 0) / paperTrades.length
    : 0;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider">Performance</h3>
      <div className="grid grid-cols-2 gap-2">
        <MetricBox
          label="Win Rate"
          value={`${stats.winRate.toFixed(1)}%`}
          sub={`${stats.wins}/${stats.totalTrades} trades`}
          color={stats.winRate >= 70 ? 'text-accent' : stats.winRate >= 50 ? 'text-chart-4' : 'text-destructive'}
        />
        <MetricBox
          label="Total P&L"
          value={`${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}`}
          sub={`${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(1)}%`}
          color={stats.totalPnl >= 0 ? 'text-accent' : 'text-destructive'}
        />
        <MetricBox
          label="Profit Factor"
          value={stats.profitFactor === 999 ? '∞' : stats.profitFactor.toFixed(2)}
          sub="Gross P / Gross L"
          color={stats.profitFactor >= 1.5 ? 'text-accent' : 'text-chart-4'}
        />
        <MetricBox
          label="Avg Edge"
          value={`${avgEdge.toFixed(1)}%`}
          sub="per trade entry"
          color="text-primary"
        />
      </div>

      {/* Target tracker */}
      <div className="rounded-lg border border-border bg-card/50 p-3">
        <p className="text-[10px] font-mono text-muted-foreground mb-2">Target: 70%+ win rate over 200 trades</p>
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-muted-foreground">Trades completed</span>
            <span className="text-foreground">{stats.totalTrades} / 200</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent" style={{ width: `${Math.min(100, (stats.totalTrades / 200) * 100)}%` }} />
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-muted-foreground">Win rate</span>
            <span className={stats.winRate >= 70 ? 'text-accent font-bold' : 'text-chart-4'}>{stats.winRate.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}