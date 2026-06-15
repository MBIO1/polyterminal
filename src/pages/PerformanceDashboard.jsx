import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, TrendingDown, DollarSign, Target, Percent,
  BarChart2, RefreshCw, Award, AlertTriangle, Zap
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';
import { format, subDays, parseISO, startOfDay } from 'date-fns';

// ── Stat tile ─────────────────────────────────────────────────────────────────
function StatTile({ label, value, sub, icon: Icon, color = 'text-foreground', trend }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
            <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg bg-secondary ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 mt-2 text-xs ${trend >= 0 ? 'text-accent' : 'text-destructive'}`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span>{trend >= 0 ? '+' : ''}{trend.toFixed(2)}% vs prev period</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt$(n) {
  if (n == null || isNaN(n)) return '$0.00';
  const abs = Math.abs(n);
  const prefix = n < 0 ? '-$' : '$';
  if (abs >= 1000) return prefix + (abs / 1000).toFixed(2) + 'k';
  return prefix + abs.toFixed(2);
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '0.00%';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}
function fmtBps(n) {
  if (n == null || isNaN(n)) return '0.0 bps';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + ' bps';
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PerformanceDashboard() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [range, setRange] = useState(30); // days

  const fetchTrades = async () => {
    setLoading(true);
    const all = await base44.entities.ArbTrade.list('-trade_date', 500);
    setTrades(all || []);
    setLastRefresh(new Date());
    setLoading(false);
  };

  useEffect(() => { fetchTrades(); }, []);

  // ── Filter by range ──────────────────────────────────────────────────────
  const filteredTrades = useMemo(() => {
    const cutoff = subDays(new Date(), range);
    return trades.filter(t => {
      const d = t.trade_date || t.entry_timestamp;
      return d ? new Date(d) >= cutoff : true;
    });
  }, [trades, range]);

  const closedTrades = useMemo(() => filteredTrades.filter(t => t.status === 'Closed'), [filteredTrades]);

  // ── Core metrics ──────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    if (!closedTrades.length) return null;

    const totalNetPnl     = closedTrades.reduce((s, t) => s + Number(t.net_pnl || 0), 0);
    const totalFees       = closedTrades.reduce((s, t) => s + Number(t.total_realized_fees || 0), 0);
    const totalGrossPnl   = closedTrades.reduce((s, t) => s + Number(t.basis_pnl || 0), 0);
    const totalCapital    = closedTrades.reduce((s, t) => s + Number(t.allocated_capital || 0), 0);
    const avgCapital      = totalCapital / closedTrades.length;

    const wins   = closedTrades.filter(t => Number(t.net_pnl || 0) > 0);
    const losses = closedTrades.filter(t => Number(t.net_pnl || 0) <= 0);
    const winRate = (wins.length / closedTrades.length) * 100;

    const avgPnlPerTrade  = totalNetPnl / closedTrades.length;
    const avgWin          = wins.length ? wins.reduce((s, t) => s + Number(t.net_pnl || 0), 0) / wins.length : 0;
    const avgLoss         = losses.length ? losses.reduce((s, t) => s + Number(t.net_pnl || 0), 0) / losses.length : 0;
    const profitFactor    = Math.abs(avgLoss) > 0 ? Math.abs(avgWin * wins.length) / Math.abs(avgLoss * losses.length) : Infinity;

    const feeAdjustedRoi  = avgCapital > 0 ? (totalNetPnl / avgCapital) * 100 : 0;
    const grossRoi        = avgCapital > 0 ? (totalGrossPnl / avgCapital) * 100 : 0;

    const avgNetBps       = closedTrades.reduce((s, t) => s + Number(t.net_pnl_bps || 0), 0) / closedTrades.length;
    const avgEntryBps     = closedTrades.reduce((s, t) => s + Number(t.entry_spread_bps || 0), 0) / closedTrades.length;

    const bestTrade   = [...closedTrades].sort((a, b) => Number(b.net_pnl || 0) - Number(a.net_pnl || 0))[0];
    const worstTrade  = [...closedTrades].sort((a, b) => Number(a.net_pnl || 0) - Number(b.net_pnl || 0))[0];

    const maxDrawdown = (() => {
      let peak = 0, dd = 0, cum = 0;
      for (const t of [...closedTrades].sort((a, b) => new Date(a.trade_date || 0) - new Date(b.trade_date || 0))) {
        cum += Number(t.net_pnl || 0);
        if (cum > peak) peak = cum;
        const d = peak - cum;
        if (d > dd) dd = d;
      }
      return dd;
    })();

    return {
      totalNetPnl, totalFees, totalGrossPnl, winRate, avgPnlPerTrade,
      avgWin, avgLoss, profitFactor, feeAdjustedRoi, grossRoi,
      avgNetBps, avgEntryBps, bestTrade, worstTrade, maxDrawdown,
      totalTrades: closedTrades.length, wins: wins.length, losses: losses.length,
      feeImpact: totalGrossPnl > 0 ? (totalFees / totalGrossPnl) * 100 : 0,
    };
  }, [closedTrades]);

  // ── Cumulative PnL chart ──────────────────────────────────────────────────
  const cumulativeData = useMemo(() => {
    const sorted = [...closedTrades].sort((a, b) => new Date(a.trade_date || 0) - new Date(b.trade_date || 0));
    let cum = 0;
    return sorted.map((t, i) => {
      cum += Number(t.net_pnl || 0);
      return { i: i + 1, pnl: Number(t.net_pnl || 0), cum: parseFloat(cum.toFixed(4)), date: t.trade_date };
    });
  }, [closedTrades]);

  // ── Daily PnL bar chart ───────────────────────────────────────────────────
  const dailyData = useMemo(() => {
    const map = {};
    for (const t of closedTrades) {
      const d = t.trade_date ? t.trade_date.slice(0, 10) : null;
      if (!d) continue;
      if (!map[d]) map[d] = 0;
      map[d] += Number(t.net_pnl || 0);
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, pnl]) => ({ date: date.slice(5), pnl: parseFloat(pnl.toFixed(4)) }));
  }, [closedTrades]);

  // ── Trade distribution ────────────────────────────────────────────────────
  const bpsDistribution = useMemo(() => {
    const buckets = { '<0': 0, '0-2': 0, '2-5': 0, '5-10': 0, '10-20': 0, '>20': 0 };
    for (const t of closedTrades) {
      const b = Number(t.net_pnl_bps || 0);
      if (b < 0) buckets['<0']++;
      else if (b < 2) buckets['0-2']++;
      else if (b < 5) buckets['2-5']++;
      else if (b < 10) buckets['5-10']++;
      else if (b < 20) buckets['10-20']++;
      else buckets['>20']++;
    }
    return Object.entries(buckets).map(([range, count]) => ({ range, count }));
  }, [closedTrades]);

  const RANGE_OPTIONS = [7, 14, 30, 90];

  return (
    <div className="px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Performance Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Fee-adjusted metrics from {closedTrades.length} closed trades
            {lastRefresh && ` · refreshed ${format(lastRefresh, 'HH:mm:ss')}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-secondary rounded-lg p-1">
            {RANGE_OPTIONS.map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${range === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {r}d
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={fetchTrades} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i} className="animate-pulse"><CardContent className="h-24 pt-5" /></Card>
          ))}
        </div>
      ) : !metrics ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No closed trades in the selected period.</CardContent></Card>
      ) : (
        <>
          {/* KPI tiles row 1 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile
              label="Total Net Profit"
              value={fmt$(metrics.totalNetPnl)}
              sub={`Gross: ${fmt$(metrics.totalGrossPnl)}`}
              icon={DollarSign}
              color={metrics.totalNetPnl >= 0 ? 'text-accent' : 'text-destructive'}
            />
            <StatTile
              label="Fee-Adjusted ROI"
              value={fmtPct(metrics.feeAdjustedRoi)}
              sub={`Gross ROI: ${fmtPct(metrics.grossRoi)}`}
              icon={Percent}
              color={metrics.feeAdjustedRoi >= 0 ? 'text-accent' : 'text-destructive'}
            />
            <StatTile
              label="Win Rate"
              value={`${metrics.winRate.toFixed(1)}%`}
              sub={`${metrics.wins}W / ${metrics.losses}L`}
              icon={Target}
              color={metrics.winRate >= 55 ? 'text-accent' : metrics.winRate >= 45 ? 'text-chart-4' : 'text-destructive'}
            />
            <StatTile
              label="Avg Profit / Trade"
              value={fmt$(metrics.avgPnlPerTrade)}
              sub={`${fmtBps(metrics.avgNetBps)} net edge`}
              icon={BarChart2}
              color={metrics.avgPnlPerTrade >= 0 ? 'text-accent' : 'text-destructive'}
            />
          </div>

          {/* KPI tiles row 2 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile
              label="Profit Factor"
              value={isFinite(metrics.profitFactor) ? metrics.profitFactor.toFixed(2) : '∞'}
              sub="Gross win / Gross loss"
              icon={Zap}
              color={metrics.profitFactor >= 1.5 ? 'text-accent' : metrics.profitFactor >= 1 ? 'text-chart-4' : 'text-destructive'}
            />
            <StatTile
              label="Total Fees Paid"
              value={fmt$(metrics.totalFees)}
              sub={`${metrics.feeImpact.toFixed(1)}% of gross PnL`}
              icon={AlertTriangle}
              color="text-chart-4"
            />
            <StatTile
              label="Max Drawdown"
              value={fmt$(metrics.maxDrawdown)}
              sub="Peak-to-trough (cumulative)"
              icon={TrendingDown}
              color="text-destructive"
            />
            <StatTile
              label="Avg Entry Spread"
              value={fmtBps(metrics.avgEntryBps)}
              sub={`Avg net: ${fmtBps(metrics.avgNetBps)}`}
              icon={Award}
              color="text-primary"
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cumulative PnL */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Cumulative Net P&L</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={cumulativeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="i" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => fmt$(v)} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6 }}
                      formatter={(v, n) => [fmt$(v), n === 'cum' ? 'Cumulative' : 'Trade PnL']}
                      labelFormatter={v => `Trade #${v}`}
                    />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="cum" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Daily PnL */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Daily Net P&L (last 30 days)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => fmt$(v)} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6 }}
                      formatter={v => [fmt$(v), 'Daily PnL']}
                    />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                    <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                      {dailyData.map((entry, i) => (
                        <Cell key={i} fill={entry.pnl >= 0 ? 'hsl(var(--accent))' : 'hsl(var(--destructive))'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Bps distribution + best/worst */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Distribution */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Trade Distribution by Net Edge (bps)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={bpsDistribution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="range" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6 }}
                      formatter={v => [v, 'Trades']}
                    />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {bpsDistribution.map((entry, i) => (
                        <Cell key={i} fill={entry.range === '<0' ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Best / worst */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Best & Worst Trades</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {metrics.bestTrade && (
                  <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-muted-foreground">Best Trade</span>
                      <Badge className="bg-accent/20 text-accent text-xs">WIN</Badge>
                    </div>
                    <p className="text-lg font-bold font-mono text-accent">{fmt$(Number(metrics.bestTrade.net_pnl))}</p>
                    <p className="text-xs text-muted-foreground mt-1">{metrics.bestTrade.trade_id} · {metrics.bestTrade.asset}</p>
                    <p className="text-xs text-muted-foreground">{fmtBps(Number(metrics.bestTrade.net_pnl_bps))} net edge</p>
                  </div>
                )}
                {metrics.worstTrade && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-muted-foreground">Worst Trade</span>
                      <Badge className="bg-destructive/20 text-destructive text-xs">LOSS</Badge>
                    </div>
                    <p className="text-lg font-bold font-mono text-destructive">{fmt$(Number(metrics.worstTrade.net_pnl))}</p>
                    <p className="text-xs text-muted-foreground mt-1">{metrics.worstTrade.trade_id} · {metrics.worstTrade.asset}</p>
                    <p className="text-xs text-muted-foreground">{fmtBps(Number(metrics.worstTrade.net_pnl_bps))} net edge</p>
                  </div>
                )}
                <div className="border-t border-border pt-3 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Avg Win</span>
                    <span className="text-accent font-mono">{fmt$(metrics.avgWin)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Avg Loss</span>
                    <span className="text-destructive font-mono">{fmt$(metrics.avgLoss)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Win/Loss Ratio</span>
                    <span className="font-mono">{Math.abs(metrics.avgLoss) > 0 ? (metrics.avgWin / Math.abs(metrics.avgLoss)).toFixed(2) : '∞'}x</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}