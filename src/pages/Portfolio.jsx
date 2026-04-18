import React, { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Wallet, TrendingUp, TrendingDown, Activity, CheckCircle, Clock } from 'lucide-react';
import { PieChart as RePieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

const COLORS = ['hsl(199,89%,48%)', 'hsl(142,71%,45%)', 'hsl(0,72%,55%)', 'hsl(45,93%,58%)'];

const StatCard = ({ label, value, sub, color = 'text-foreground', icon: Icon }) => (
  <div className="rounded-xl border border-border bg-card p-4 space-y-1">
    <div className="flex items-center justify-between">
      <p className="text-xs text-muted-foreground font-mono">{label}</p>
      {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
    </div>
    <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
    {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
  </div>
);

export default function Portfolio() {
  const { data: configs = [] } = useQuery({
    queryKey: ['bot-config'],
    queryFn: () => base44.entities.BotConfig.list(),
  });

  const [trades, setTrades] = React.useState([]);
  const { isLoading } = useQuery({
    queryKey: ['bot-trades-portfolio'],
    queryFn: () => base44.entities.BotTrade.list('-created_date', 500),
    onSuccess: (data) => setTrades(data),
  });

  React.useEffect(() => {
    const unsubscribe = base44.entities.BotTrade.subscribe((event) => {
      if (event.type === 'create') {
        setTrades(prev => [event.data, ...prev]);
      } else if (event.type === 'update') {
        setTrades(prev => prev.map(t => t.id === event.id ? event.data : t));
      }
    });
    return unsubscribe;
  }, []);

  const config = configs[0] || {};
  const startingBalance = config.starting_balance || 1000;

  const { totalPnl, portfolioValue, winCount, lossCount, pendingCount, btcPnl, ethPnl, assetPie, modePie } = useMemo(() => {
    const totalPnl = trades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
    const portfolioValue = startingBalance + totalPnl;
    const winCount     = trades.filter(t => t.outcome === 'win').length;
    const lossCount    = trades.filter(t => t.outcome === 'loss').length;
    const pendingCount = trades.filter(t => t.outcome === 'pending').length;
    const btcPnl = trades.filter(t => t.asset === 'BTC').reduce((s, t) => s + (t.pnl_usdc || 0), 0);
    const ethPnl = trades.filter(t => t.asset === 'ETH').reduce((s, t) => s + (t.pnl_usdc || 0), 0);

    const assetPie = [
      { name: 'BTC', value: Math.max(0, trades.filter(t => t.asset === 'BTC').reduce((s, t) => s + (t.size_usdc || 0), 0)) },
      { name: 'ETH', value: Math.max(0, trades.filter(t => t.asset === 'ETH').reduce((s, t) => s + (t.size_usdc || 0), 0)) },
    ].filter(d => d.value > 0);

    const paperVol = trades.filter(t => t.mode === 'paper').reduce((s, t) => s + (t.size_usdc || 0), 0);
    const liveVol  = trades.filter(t => t.mode === 'live').reduce((s, t) => s + (t.size_usdc || 0), 0);
    const modePie  = [
      { name: 'Paper', value: paperVol },
      { name: 'Live',  value: liveVol },
    ].filter(d => d.value > 0);

    return { totalPnl, portfolioValue, winCount, lossCount, pendingCount, btcPnl, ethPnl, assetPie, modePie };
  }, [trades, startingBalance]);

  const pnlPct = totalPnl !== 0 ? ((totalPnl / startingBalance) * 100).toFixed(1) : '0.0';
  const recentTrades = trades.slice(0, 20);

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Portfolio</h1>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          Based on {trades.length} bot trades · Starting balance ${startingBalance.toLocaleString()}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Portfolio Value"
          value={`$${portfolioValue.toFixed(2)}`}
          sub={`Started at $${startingBalance.toLocaleString()}`}
          color="text-foreground"
          icon={Wallet}
        />
        <StatCard
          label="Total P&L"
          value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`}
          sub={`${pnlPct}% return on starting balance`}
          color={totalPnl >= 0 ? 'text-accent' : 'text-destructive'}
          icon={totalPnl >= 0 ? TrendingUp : TrendingDown}
        />
        <StatCard
          label="Win / Loss"
          value={`${winCount}W / ${lossCount}L`}
          sub={`${trades.length > 0 ? ((winCount / (winCount + lossCount || 1)) * 100).toFixed(1) : 0}% win rate`}
          color="text-primary"
          icon={CheckCircle}
        />
        <StatCard
          label="Pending Trades"
          value={pendingCount}
          sub="awaiting resolution"
          color={pendingCount > 0 ? 'text-chart-4' : 'text-muted-foreground'}
          icon={Clock}
        />
      </div>

      {/* Charts + breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Asset allocation */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Volume by Asset</h3>
          {assetPie.length > 0 ? (
            <>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie data={assetPie} cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={4} dataKey="value">
                      {assetPie.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                    </Pie>
                    <Tooltip content={({ active, payload }) =>
                      active && payload?.length ? (
                        <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
                          <p className="text-muted-foreground">{payload[0].name}</p>
                          <p className="font-bold text-foreground">${payload[0].value.toFixed(2)}</p>
                        </div>
                      ) : null}
                    />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 mt-3">
                {[{ label: 'BTC P&L', value: btcPnl }, { label: 'ETH P&L', value: ethPnl }].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center text-xs font-mono">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={value >= 0 ? 'text-accent font-bold' : 'text-destructive font-bold'}>
                      {value >= 0 ? '+' : ''}${value.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">No trade data yet</p>
          )}
        </div>

        {/* Mode breakdown */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Paper vs Live Volume</h3>
          {modePie.length > 0 ? (
            <>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie data={modePie} cx="50%" cy="50%" innerRadius={44} outerRadius={72} paddingAngle={4} dataKey="value">
                      {modePie.map((_, i) => <Cell key={i} fill={COLORS[i + 2] || COLORS[i]} />)}
                    </Pie>
                    <Tooltip content={({ active, payload }) =>
                      active && payload?.length ? (
                        <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
                          <p className="text-muted-foreground">{payload[0].name}</p>
                          <p className="font-bold text-foreground">${payload[0].value.toFixed(2)}</p>
                        </div>
                      ) : null}
                    />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-6 mt-3">
                {modePie.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i + 2] || COLORS[i] }} />
                    {d.name}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">No trade data yet</p>
          )}
        </div>

        {/* Contract breakdown */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">P&L by Contract Type</h3>
          {trades.length > 0 ? (
            <div className="space-y-2">
              {['5min_up', '5min_down', '15min_up', '15min_down'].map(ct => {
                const ctTrades = trades.filter(t => t.contract_type === ct);
                const pnl = ctTrades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
                const wins = ctTrades.filter(t => t.outcome === 'win').length;
                const total = ctTrades.filter(t => t.outcome !== 'pending').length;
                return (
                  <div key={ct} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0 text-xs font-mono">
                    <div>
                      <p className="text-foreground">{ct.replace(/_/g, ' ')}</p>
                      <p className="text-muted-foreground">{ctTrades.length} trades · {total > 0 ? ((wins/total)*100).toFixed(0) : 0}% WR</p>
                    </div>
                    <span className={`font-bold ${pnl >= 0 ? 'text-accent' : 'text-destructive'}`}>
                      {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">No trade data yet</p>
          )}
        </div>
      </div>

      {/* Recent trades */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Recent Trades</h3>
        {isLoading ? (
          <div className="space-y-2">
            {Array(5).fill(0).map((_, i) => <div key={i} className="h-10 bg-secondary rounded animate-pulse" />)}
          </div>
        ) : recentTrades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-left">
                  {['Date', 'Asset', 'Contract', 'Side', 'Size', 'P&L', 'Outcome', 'Mode'].map(h => (
                    <th key={h} className="pb-2 font-medium pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentTrades.map(t => (
                  <tr key={t.id} className="border-b border-border/30 last:border-0 hover:bg-secondary/20">
                    <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                      {t.created_date ? format(new Date(t.created_date), 'MMM d HH:mm') : '–'}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.asset === 'BTC' ? 'bg-chart-4/10 text-chart-4' : 'bg-primary/10 text-primary'}`}>
                        {t.asset}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-foreground">{t.contract_type?.replace(/_/g, ' ') || '–'}</td>
                    <td className="py-2 pr-4">
                      <Badge variant="outline" className={`text-[10px] ${t.side === 'yes' ? 'border-accent/40 text-accent' : 'border-destructive/40 text-destructive'}`}>
                        {t.side?.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4">${(t.size_usdc || 0).toFixed(2)}</td>
                    <td className={`py-2 pr-4 font-bold ${(t.pnl_usdc || 0) >= 0 ? 'text-accent' : 'text-destructive'}`}>
                      {t.pnl_usdc != null ? `${t.pnl_usdc >= 0 ? '+' : ''}$${t.pnl_usdc.toFixed(2)}` : '–'}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant="outline" className={`text-[10px] ${
                        t.outcome === 'win' ? 'border-accent/40 text-accent' :
                        t.outcome === 'loss' ? 'border-destructive/40 text-destructive' :
                        'border-primary/40 text-primary'
                      }`}>{t.outcome}</Badge>
                    </td>
                    <td className="py-2 text-muted-foreground">{t.mode || 'paper'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No trades yet — start the bot</p>
        )}
      </div>
    </div>
  );
}