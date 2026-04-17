import React, { useMemo } from 'react';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

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

const MetricCard = ({ label, value, sub, color = 'text-foreground' }) => (
  <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3">
    <p className="text-[11px] text-muted-foreground font-mono mb-1">{label}</p>
    <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
    {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
  </div>
);

export default function PerformanceSection({ trades }) {
  const resolved = useMemo(() => trades.filter(t => t.outcome === 'win' || t.outcome === 'loss'), [trades]);

  // ── Core metrics ──────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const wins  = resolved.filter(t => t.outcome === 'win');
    const losses = resolved.filter(t => t.outcome === 'loss');
    const winRate = resolved.length > 0 ? (wins.length / resolved.length * 100) : 0;

    const grossWin  = wins.reduce((s, t)   => s + (t.pnl_usdc || 0), 0);
    const grossLoss = losses.reduce((s, t) => s + Math.abs(t.pnl_usdc || 0), 0);
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : wins.length > 0 ? Infinity : 0;

    const totalPnl = trades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
    const avgPnl   = resolved.length > 0 ? totalPnl / resolved.length : 0;

    return { winRate, profitFactor, avgPnl, totalPnl, tradeCount: trades.length };
  }, [trades, resolved]);

  // ── Equity curve + drawdown ───────────────────────────────────────────────
  const { equityCurve, drawdownSeries } = useMemo(() => {
    const sorted = [...trades].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    let cum = 0, peak = 0;
    const equity = [];
    const dd     = [];
    sorted.forEach((t, i) => {
      cum += t.pnl_usdc || 0;
      if (cum > peak) peak = cum;
      const drawdown = peak > 0 ? ((peak - cum) / peak) * 100 : 0;
      const label = t.created_date?.slice(5, 10) || String(i + 1);
      equity.push({ idx: i + 1, label, cumPnl: Number(cum.toFixed(2)) });
      dd.push({ idx: i + 1, label, drawdown: Number((-drawdown).toFixed(2)) });
    });
    return { equityCurve: equity, drawdownSeries: dd };
  }, [trades]);

  const maxDD = useMemo(() => {
    if (!drawdownSeries.length) return 0;
    return Math.min(...drawdownSeries.map(d => d.drawdown));
  }, [drawdownSeries]);

  if (trades.length === 0) return null;

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          label="Win Rate"
          value={`${metrics.winRate.toFixed(1)}%`}
          sub={`${resolved.length} resolved trades`}
          color={metrics.winRate >= 50 ? 'text-accent' : 'text-destructive'}
        />
        <MetricCard
          label="Profit Factor"
          value={isFinite(metrics.profitFactor) ? metrics.profitFactor.toFixed(2) : '∞'}
          sub="gross win / gross loss"
          color={metrics.profitFactor >= 1 ? 'text-accent' : 'text-destructive'}
        />
        <MetricCard
          label="Avg P&L / Trade"
          value={`${metrics.avgPnl >= 0 ? '+' : ''}$${metrics.avgPnl.toFixed(2)}`}
          sub="across resolved trades"
          color={metrics.avgPnl >= 0 ? 'text-accent' : 'text-destructive'}
        />
        <MetricCard
          label="Max Drawdown"
          value={`${maxDD.toFixed(1)}%`}
          sub="peak-to-trough"
          color={maxDD < -20 ? 'text-destructive' : maxDD < -10 ? 'text-chart-4' : 'text-foreground'}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Equity curve */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Equity Curve</h3>
          <p className="text-xs text-muted-foreground mb-4">Cumulative P&L across all trades</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityCurve}>
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
          <h3 className="text-sm font-semibold text-foreground mb-1">Drawdown Over Time</h3>
          <p className="text-xs text-muted-foreground mb-4">Peak-to-trough decline at each trade</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={drawdownSeries}>
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