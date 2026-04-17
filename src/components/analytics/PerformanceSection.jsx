import React, { useMemo } from 'react';
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { computeMetrics } from '@/lib/tradeMetrics';

const ChartTooltip = ({ active, payload, label, prefix = '', suffix = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-bold">
          {p.name}: {prefix}{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}{suffix}
        </p>
      ))}
    </div>
  );
};

const MetricCard = ({ label, value, sub, color = 'text-foreground', badge }) => (
  <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3">
    <div className="flex items-center justify-between mb-1">
      <p className="text-[11px] text-muted-foreground font-mono">{label}</p>
      {badge && (
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{badge}</span>
      )}
    </div>
    <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
    {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
  </div>
);

const MiniStat = ({ label, value, color = 'text-foreground' }) => (
  <div className="flex justify-between items-center py-1 border-b border-border/30 last:border-0">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className={`text-xs font-mono font-bold ${color}`}>{value}</span>
  </div>
);

export default function PerformanceSection({ trades, startingBalance = 1000 }) {
  const m = useMemo(() => computeMetrics(trades, startingBalance), [trades, startingBalance]);

  if (trades.length === 0) return null;

  const pfColor    = m.profitFactor >= 1.5 ? 'text-accent' : m.profitFactor >= 1 ? 'text-chart-4' : 'text-destructive';
  const sharpeColor = m.sharpeRatio >= 1 ? 'text-accent' : m.sharpeRatio >= 0 ? 'text-chart-4' : 'text-destructive';
  const ddColor    = m.maxDrawdown < -20 ? 'text-destructive' : m.maxDrawdown < -10 ? 'text-chart-4' : 'text-foreground';

  return (
    <div className="space-y-5">
      {/* Row 1: Core KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          label="Win Rate"
          value={`${m.winRate.toFixed(1)}%`}
          sub={`${m.resolvedCount} resolved trades`}
          color={m.winRate >= 50 ? 'text-accent' : 'text-destructive'}
        />
        <MetricCard
          label="Profit Factor"
          value={m.profitFactor >= 999 ? '∞' : m.profitFactor.toFixed(2)}
          sub="gross win / gross loss"
          color={pfColor}
        />
        <MetricCard
          label="Sharpe Ratio"
          value={m.sharpeRatio !== 0 ? m.sharpeRatio.toFixed(2) : '—'}
          sub="annualized · risk-free=0"
          color={sharpeColor}
          badge="annlzd"
        />
        <MetricCard
          label="Avg P&L / Trade"
          value={`${m.avgPnl >= 0 ? '+' : ''}$${m.avgPnl.toFixed(2)}`}
          sub="realized trades only"
          color={m.avgPnl >= 0 ? 'text-accent' : 'text-destructive'}
        />
      </div>

      {/* Row 2: Drawdown + Realized/Unrealized + Mode Win Rates */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

        {/* Drawdown block */}
        <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3 space-y-1.5">
          <p className="text-[11px] text-muted-foreground font-mono mb-2">Drawdown Analysis</p>
          <MiniStat
            label="Max Drawdown"
            value={`${m.maxDrawdown.toFixed(1)}%`}
            color={ddColor}
          />
          <MiniStat
            label="Trailing (current)"
            value={`${m.trailingDrawdown.toFixed(1)}%`}
            color={m.trailingDrawdown < -10 ? 'text-chart-4' : 'text-foreground'}
          />
          <MiniStat
            label="Peak P&L"
            value={`$${(m.equityCurve.length > 0 ? Math.max(...m.equityCurve.map(e => e.cumPnl)) : 0).toFixed(2)}`}
            color="text-accent"
          />
        </div>

        {/* Realized vs Unrealized */}
        <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3 space-y-1.5">
          <p className="text-[11px] text-muted-foreground font-mono mb-2">P&L Breakdown</p>
          <MiniStat
            label="Realized P&L"
            value={`${m.realizedPnl >= 0 ? '+' : ''}$${m.realizedPnl.toFixed(2)}`}
            color={m.realizedPnl >= 0 ? 'text-accent' : 'text-destructive'}
          />
          <MiniStat
            label="Unrealized P&L"
            value={m.pendingCount > 0 ? `${m.unrealizedPnl >= 0 ? '+' : ''}$${m.unrealizedPnl.toFixed(2)}` : '—'}
            color={m.unrealizedPnl >= 0 ? 'text-primary' : 'text-chart-4'}
          />
          <MiniStat
            label={`Open Positions (${m.pendingCount})`}
            value={`$${(m.pendingCount > 0 ? trades.filter(t => t.outcome === 'pending').reduce((s, t) => s + (t.size_usdc || 0), 0) : 0).toFixed(2)} at risk`}
            color="text-muted-foreground"
          />
        </div>

        {/* Win rate by mode */}
        <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3 space-y-1.5">
          <p className="text-[11px] text-muted-foreground font-mono mb-2">Win Rate by Mode</p>
          <MiniStat
            label={`📄 Paper (${m.paperCount} trades)`}
            value={m.paperWinRate !== null ? `${m.paperWinRate.toFixed(1)}%` : '—'}
            color={m.paperWinRate !== null ? (m.paperWinRate >= 50 ? 'text-accent' : 'text-destructive') : 'text-muted-foreground'}
          />
          <MiniStat
            label={`💰 Live (${m.liveCount} trades)`}
            value={m.liveWinRate !== null ? `${m.liveWinRate.toFixed(1)}%` : '—'}
            color={m.liveWinRate !== null ? (m.liveWinRate >= 50 ? 'text-accent' : 'text-destructive') : 'text-muted-foreground'}
          />
          <MiniStat
            label="Overall"
            value={`${m.winRate.toFixed(1)}%`}
            color={m.winRate >= 50 ? 'text-accent' : 'text-destructive'}
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Equity curve */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Equity Curve</h3>
          <p className="text-xs text-muted-foreground mb-4">Cumulative realized P&L across all trades</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={m.equityCurve}>
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(199 89% 48%)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="hsl(199 89% 48%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                <XAxis dataKey="idx" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip content={<ChartTooltip prefix="$" />} />
                <ReferenceLine y={0} stroke="hsl(215 14% 30%)" strokeDasharray="4 2" />
                <Area type="monotone" dataKey="cumPnl" name="Equity" stroke="hsl(199 89% 48%)" strokeWidth={2} fill="url(#equityGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Drawdown */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-foreground">Drawdown Over Time</h3>
            <span className="text-[10px] font-mono text-destructive">Max: {m.maxDrawdown.toFixed(1)}% · Now: {m.trailingDrawdown.toFixed(1)}%</span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Peak-to-trough at each trade · trailing = current from peak</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={m.drawdownSeries}>
                <defs>
                  <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(0 72% 55%)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="hsl(0 72% 55%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                <XAxis dataKey="idx" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `${v}%`} />
                <Tooltip content={<ChartTooltip suffix="%" />} />
                <ReferenceLine y={0} stroke="hsl(215 14% 30%)" strokeDasharray="4 2" />
                <Area type="monotone" dataKey="drawdown" name="Drawdown" stroke="hsl(0 72% 55%)" strokeWidth={2} fill="url(#ddGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}