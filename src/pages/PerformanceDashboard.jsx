import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, PieChart, Pie, Legend
} from 'recharts';

const TABS = ['Cumulative P&L', 'Win/Loss', 'Trade Activity', 'Asset Breakdown'];

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

const StatCard = ({ label, value, sub, color = 'text-foreground' }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <p className="text-xs text-muted-foreground font-mono mb-1">{label}</p>
    <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
    {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
  </div>
);

export default function PerformanceDashboard() {
  const [activeTab, setActiveTab] = useState(0);

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['perf-dashboard-trades'],
    queryFn: () => base44.entities.BotTrade.list('-created_date', 1000),
    refetchInterval: 30000,
  });

  const { data: configs = [] } = useQuery({
    queryKey: ['bot-config'],
    queryFn: () => base44.entities.BotConfig.list(),
  });

  const startingBalance = configs[0]?.starting_balance || 1000;

  // ── Cumulative P&L series ──────────────────────────────────────────────────
  const cumulativeSeries = useMemo(() => {
    const sorted = [...trades]
      .filter(t => t.outcome !== 'pending' && t.outcome !== 'cancelled')
      .sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    let cum = startingBalance;
    return sorted.map((t) => {
      cum += t.pnl_usdc || 0;
      return {
        date: t.created_date?.slice(0, 10),
        label: t.created_date?.slice(5, 10),
        portfolio: Number(cum.toFixed(2)),
        pnl: Number((t.pnl_usdc || 0).toFixed(3)),
      };
    });
  }, [trades, startingBalance]);

  // ── Daily P&L aggregated ──────────────────────────────────────────────────
  const dailyPnl = useMemo(() => {
    const map = {};
    trades.forEach(t => {
      const day = t.created_date?.slice(0, 10);
      if (!day || t.outcome === 'pending') return;
      if (!map[day]) map[day] = { pnl: 0, wins: 0, losses: 0 };
      map[day].pnl += t.pnl_usdc || 0;
      if (t.outcome === 'win') map[day].wins++;
      else if (t.outcome === 'loss') map[day].losses++;
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, d]) => ({
        date: date.slice(5),
        pnl: Number(d.pnl.toFixed(2)),
        wins: d.wins,
        losses: d.losses,
        total: d.wins + d.losses,
        winRate: d.wins + d.losses > 0 ? Number(((d.wins / (d.wins + d.losses)) * 100).toFixed(1)) : 0,
      }));
  }, [trades]);

  // ── Win/Loss breakdown ────────────────────────────────────────────────────
  const resolved = trades.filter(t => t.outcome === 'win' || t.outcome === 'loss');
  const wins = resolved.filter(t => t.outcome === 'win').length;
  const losses = resolved.filter(t => t.outcome === 'loss').length;
  const winRate = resolved.length > 0 ? (wins / resolved.length * 100).toFixed(1) : 0;
  const totalPnl = trades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
  const active = trades.filter(t => t.outcome === 'pending').length;
  const closed = trades.filter(t => t.outcome !== 'pending').length;

  const pieData = [
    { name: 'Wins', value: wins, fill: 'hsl(142 71% 45%)' },
    { name: 'Losses', value: losses, fill: 'hsl(0 72% 55%)' },
    { name: 'Active', value: active, fill: 'hsl(199 89% 48%)' },
  ];

  // ── Asset breakdown ───────────────────────────────────────────────────────
  const assetBreakdown = useMemo(() => {
    const map = {};
    trades.forEach(t => {
      const k = `${t.asset}-${t.contract_type}`;
      if (!map[k]) map[k] = { key: k, asset: t.asset, type: t.contract_type, wins: 0, losses: 0, pnl: 0 };
      if (t.outcome === 'win') map[k].wins++;
      else if (t.outcome === 'loss') map[k].losses++;
      map[k].pnl += t.pnl_usdc || 0;
    });
    return Object.values(map).map(d => ({
      ...d,
      total: d.wins + d.losses,
      winRate: d.wins + d.losses > 0 ? Number(((d.wins / (d.wins + d.losses)) * 100).toFixed(1)) : 0,
      pnl: Number(d.pnl.toFixed(2)),
    })).sort((a, b) => b.pnl - a.pnl);
  }, [trades]);

  // ── Active vs Closed over time ────────────────────────────────────────────
  const activitySeries = useMemo(() => {
    const map = {};
    trades.forEach(t => {
      const day = t.created_date?.slice(0, 10);
      if (!day) return;
      if (!map[day]) map[day] = { active: 0, closed: 0 };
      if (t.outcome === 'pending') map[day].active++;
      else map[day].closed++;
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, d]) => ({ date: date.slice(5), ...d }));
  }, [trades]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Performance Dashboard</h1>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          {trades.length} total trades · {active} active · {closed} closed · Win rate {winRate}%
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total P&L" value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`} color={totalPnl >= 0 ? 'text-accent' : 'text-destructive'} sub={`Starting: $${startingBalance}`} />
        <StatCard label="Win Rate" value={`${winRate}%`} color={parseFloat(winRate) >= 50 ? 'text-accent' : 'text-destructive'} sub={`${wins}W / ${losses}L`} />
        <StatCard label="Active Trades" value={active} color="text-primary" sub="pending settlement" />
        <StatCard label="Portfolio Value" value={`$${(startingBalance + totalPnl).toFixed(2)}`} sub={`${totalPnl >= 0 ? '+' : ''}${((totalPnl / startingBalance) * 100).toFixed(1)}% return`} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-secondary/50 border border-border w-fit">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === i ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="rounded-xl border border-border bg-card p-5">
        {activeTab === 0 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Daily Cumulative P&L</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Portfolio value growth over all settled trades</p>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cumulativeSeries}>
                  <defs>
                    <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(199 89% 48%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(199 89% 48%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<ChartTooltip prefix="$" />} />
                  <ReferenceLine y={startingBalance} stroke="hsl(45 93% 58%)" strokeDasharray="4 2" label={{ value: 'Start', fill: 'hsl(45 93% 58%)', fontSize: 9, position: 'right' }} />
                  <Area type="monotone" dataKey="portfolio" name="Portfolio" stroke="hsl(199 89% 48%)" strokeWidth={2} fill="url(#portfolioGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground mt-4">Daily P&L</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Net profit/loss per calendar day (last 30 days)</p>
            </div>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyPnl}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<ChartTooltip prefix="$" />} />
                  <ReferenceLine y={0} stroke="hsl(215 14% 30%)" />
                  <Bar dataKey="pnl" name="P&L" radius={[3, 3, 0, 0]}>
                    {dailyPnl.map((d, i) => (
                      <Cell key={i} fill={d.pnl >= 0 ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {activeTab === 1 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Win/Loss Distribution</h3>
                <p className="text-xs text-muted-foreground mb-4">Total trade outcome breakdown</p>
                <div className="h-64 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} paddingAngle={3}>
                        {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip formatter={(val, name) => [val, name]} contentStyle={{ background: 'hsl(220 18% 7%)', border: '1px solid hsl(220 14% 14%)', borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }} />
                      <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'monospace' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">Daily Win Rate</h3>
                <p className="text-xs text-muted-foreground mb-4">% winning trades per day (last 30 days)</p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyPnl}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `${v}%`} />
                      <Tooltip content={<ChartTooltip suffix="%" />} />
                      <ReferenceLine y={50} stroke="hsl(45 93% 58%)" strokeDasharray="4 2" />
                      <Bar dataKey="winRate" name="Win Rate" radius={[3, 3, 0, 0]}>
                        {dailyPnl.map((d, i) => (
                          <Cell key={i} fill={d.winRate >= 50 ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Daily wins/losses stacked */}
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">Daily Wins vs Losses</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyPnl}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
                    <Tooltip contentStyle={{ background: 'hsl(220 18% 7%)', border: '1px solid hsl(220 14% 14%)', borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }} />
                    <Bar dataKey="wins" name="Wins" stackId="a" fill="hsl(142 71% 45%)" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="losses" name="Losses" stackId="a" fill="hsl(0 72% 55%)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {activeTab === 2 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Active vs Closed Trades per Day</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Daily breakdown of pending vs settled positions</p>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activitySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(220 18% 7%)', border: '1px solid hsl(220 14% 14%)', borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }} />
                  <Bar dataKey="active" name="Active" fill="hsl(199 89% 48%)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="closed" name="Closed" fill="hsl(142 71% 45%)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Summary table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="pb-2 text-left">Date</th>
                    <th className="pb-2 text-right">Active</th>
                    <th className="pb-2 text-right">Closed</th>
                    <th className="pb-2 text-right">Total</th>
                    <th className="pb-2 text-right">Win Rate</th>
                    <th className="pb-2 text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {[...dailyPnl].reverse().slice(0, 14).map((d, i) => (
                    <tr key={i} className="border-b border-border/20 hover:bg-secondary/20 transition-colors">
                      <td className="py-1.5">{d.date}</td>
                      <td className="py-1.5 text-right text-primary">{activitySeries.find(a => a.date === d.date)?.active || 0}</td>
                      <td className="py-1.5 text-right text-accent">{activitySeries.find(a => a.date === d.date)?.closed || 0}</td>
                      <td className="py-1.5 text-right">{d.total}</td>
                      <td className={`py-1.5 text-right font-bold ${d.winRate >= 50 ? 'text-accent' : 'text-destructive'}`}>{d.winRate}%</td>
                      <td className={`py-1.5 text-right font-bold ${d.pnl >= 0 ? 'text-accent' : 'text-destructive'}`}>{d.pnl >= 0 ? '+' : ''}${d.pnl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 3 && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">P&L by Contract Type</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Performance breakdown per asset/contract combination</p>
            </div>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={assetBreakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `$${v}`} />
                  <YAxis dataKey="key" type="category" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} width={90} />
                  <Tooltip content={<ChartTooltip prefix="$" />} />
                  <ReferenceLine x={0} stroke="hsl(215 14% 30%)" />
                  <Bar dataKey="pnl" name="P&L" radius={[0, 3, 3, 0]}>
                    {assetBreakdown.map((d, i) => (
                      <Cell key={i} fill={d.pnl >= 0 ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="pb-2 text-left">Contract</th>
                    <th className="pb-2 text-right">Trades</th>
                    <th className="pb-2 text-right">Wins</th>
                    <th className="pb-2 text-right">Win Rate</th>
                    <th className="pb-2 text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {assetBreakdown.map((d, i) => (
                    <tr key={i} className="border-b border-border/20 hover:bg-secondary/20 transition-colors">
                      <td className="py-1.5">
                        <span className={`px-1 py-0.5 rounded text-[9px] font-bold mr-1 ${d.asset === 'BTC' ? 'bg-chart-4/10 text-chart-4' : 'bg-primary/10 text-primary'}`}>{d.asset}</span>
                        {d.type?.replace(/_/g, ' ')}
                      </td>
                      <td className="py-1.5 text-right">{d.total}</td>
                      <td className="py-1.5 text-right text-accent">{d.wins}</td>
                      <td className={`py-1.5 text-right font-bold ${d.winRate >= 50 ? 'text-accent' : 'text-destructive'}`}>{d.winRate}%</td>
                      <td className={`py-1.5 text-right font-bold ${d.pnl >= 0 ? 'text-accent' : 'text-destructive'}`}>{d.pnl >= 0 ? '+' : ''}${d.pnl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}