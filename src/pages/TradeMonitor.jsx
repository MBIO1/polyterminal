import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Radio, Play, Loader2, Clock, Activity, TrendingUp, TrendingDown, Zap } from 'lucide-react';
import { toast } from 'sonner';
import Section from '@/components/arb/Section';
import StatTile from '@/components/arb/StatTile';
import EmptyState from '@/components/arb/EmptyState';
import LivePnlChart from '@/components/arb/LivePnlChart';
import SignalFeed from '@/components/arb/SignalFeed';
import { fmtUSD } from '@/lib/arbMath';

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export default function TradeMonitor() {
  const qc = useQueryClient();
  const [executing, setExecuting] = useState(new Set());
  const [wsEvents, setWsEvents] = useState([]); // real-time subscription events

  // Real-time WebSocket subscription to ArbSignal changes
  useEffect(() => {
    const unsub = base44.entities.ArbSignal.subscribe(event => {
      setWsEvents(prev => [{ ...event, ts: Date.now() }, ...prev].slice(0, 5));
      qc.invalidateQueries({ queryKey: ['tm-signals'] });
      qc.invalidateQueries({ queryKey: ['tm-trades'] });
    });
    return unsub;
  }, [qc]);

  // Also subscribe to ArbTrade changes for live PnL updates
  useEffect(() => {
    const unsub = base44.entities.ArbTrade.subscribe(() => {
      qc.invalidateQueries({ queryKey: ['tm-trades'] });
    });
    return unsub;
  }, [qc]);

  const { data: allSignals = [] } = useQuery({
    queryKey: ['tm-signals'],
    queryFn: () => base44.entities.ArbSignal.list('-received_time', 60),
    refetchInterval: 3000,
  });

  const { data: trades = [] } = useQuery({
    queryKey: ['tm-trades'],
    queryFn: () => base44.entities.ArbTrade.list('-created_date', 200),
    refetchInterval: 10_000,
  });

  const pending = allSignals.filter(s => s.status === 'detected' || s.status === 'alerted');
  const recentAll = allSignals;

  // PnL stats
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayTrades = trades.filter(t => (t.trade_date || '').startsWith(todayStr) && t.status === 'Closed');
  const todayPnl = todayTrades.reduce((a, t) => a + Number(t.net_pnl || 0), 0);
  const totalPnl = trades.filter(t => t.status === 'Closed').reduce((a, t) => a + Number(t.net_pnl || 0), 0);
  const wins = trades.filter(t => t.status === 'Closed' && Number(t.net_pnl || 0) > 0).length;
  const closedCount = trades.filter(t => t.status === 'Closed').length;
  const winRate = closedCount > 0 ? Math.round((wins / closedCount) * 100) : 0;

  const forceExecute = useCallback(async (signalId, pair) => {
    setExecuting(prev => new Set(prev).add(signalId));
    try {
      const res = await base44.functions.invoke('executeSignals', { signal_id: signalId, dry_run: false });
      const result = res?.data?.results?.[0];
      if (result?.decision === 'executed') {
        toast.success(`${pair} executed`, {
          description: `Trade ${result.trade_id} · PnL ${result.net_pnl_usd >= 0 ? '+' : ''}$${Number(result.net_pnl_usd).toFixed(2)}`,
        });
      } else if (result?.decision === 'rejected') {
        toast.error(`${pair} rejected`, { description: (result.reasons || []).join(', ') });
      } else {
        toast.info(`${pair}: ${result?.decision || 'no result'}`);
      }
      qc.invalidateQueries({ queryKey: ['tm-signals'] });
      qc.invalidateQueries({ queryKey: ['tm-trades'] });
    } catch (e) {
      toast.error('Execution failed', { description: e.message });
    } finally {
      setExecuting(prev => { const n = new Set(prev); n.delete(signalId); return n; });
    }
  }, [qc]);

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">

      {/* Header */}
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Trade Monitor
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            Real-time signals · execution · live PnL
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse-glow" />
          <span className="text-xs font-mono text-muted-foreground">WebSocket live</span>
        </div>
      </header>

      {/* WS Event ticker */}
      {wsEvents.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/30 bg-primary/5 overflow-hidden">
          <Zap className="w-3.5 h-3.5 text-primary flex-shrink-0 animate-pulse" />
          <div className="text-xs font-mono text-primary truncate">
            {(() => {
              const e = wsEvents[0];
              const d = e.data || {};
              return `[${e.type?.toUpperCase()}] ${d.pair || '—'} · ${Number(d.net_edge_bps || 0).toFixed(1)} bps · ${d.status || '—'} · ${timeAgo(e.ts)}`;
            })()}
          </div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          label="Today PnL"
          value={`${todayPnl >= 0 ? '+' : ''}$${todayPnl.toFixed(2)}`}
          sub={`${todayTrades.length} trades today`}
          tone={todayPnl >= 0 ? 'positive' : 'negative'}
        />
        <StatTile
          label="Total PnL"
          value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`}
          sub={`${closedCount} closed trades`}
          tone={totalPnl >= 0 ? 'positive' : 'negative'}
        />
        <StatTile
          label="Win Rate"
          value={`${winRate}%`}
          sub={`${wins}W / ${closedCount - wins}L`}
          tone={winRate >= 50 ? 'positive' : 'negative'}
        />
        <StatTile
          label="Pending Signals"
          value={pending.length}
          sub={pending.length > 0 ? `Oldest: ${timeAgo(pending[pending.length - 1]?.received_time)}` : 'Queue clear'}
          tone={pending.length > 0 ? 'warn' : 'muted'}
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Pending signals + force execute */}
        <Section
          title="Pending Signals"
          subtitle={`${pending.length} awaiting execution · click Force Execute to route now`}
        >
          {pending.length === 0 ? (
            <EmptyState
              title="No pending signals"
              subtitle="New signals appear instantly via WebSocket"
              icon={Radio}
            />
          ) : (
            <div className="space-y-2">
              {pending.map(s => {
                const isBusy = executing.has(s.id);
                const edge = Number(s.net_edge_bps || 0);
                return (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border bg-secondary/20 hover:bg-secondary/40 transition-colors"
                  >
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-foreground">{s.pair}</span>
                        <span className={`text-xs font-mono font-bold ${edge >= 20 ? 'text-accent' : 'text-chart-4'}`}>
                          {edge.toFixed(1)} bps
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {fmtUSD(s.fillable_size_usd || 0, 0)} fillable
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {s.buy_exchange} → {s.sell_exchange} · {timeAgo(s.received_time || s.created_date)}
                      </div>
                    </div>
                    <button
                      onClick={() => forceExecute(s.id, s.pair)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    >
                      {isBusy
                        ? <><Loader2 className="w-3 h-3 animate-spin" />Executing…</>
                        : <><Play className="w-3 h-3" />Force Execute</>
                      }
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* Live signal feed (all statuses) */}
        <Section
          title="Live Signal Feed"
          subtitle="All recent signals with status · green = profit, red = loss"
        >
          {recentAll.length === 0
            ? <EmptyState title="No signals yet" subtitle="Waiting for droplet bot to post" icon={Radio} />
            : <SignalFeed signals={recentAll} />
          }
        </Section>

      </div>

      {/* Daily PnL chart */}
      <Section
        title="Daily Realized PnL"
        subtitle="Bars = daily · Line = cumulative · Green above zero = profit"
      >
        <LivePnlChart trades={trades} days={14} />
      </Section>

      {/* Recent executed trades table */}
      <Section
        title="Recent Executed Trades"
        subtitle="Last 20 closed trades with PnL outcome"
      >
        {trades.filter(t => t.status === 'Closed').length === 0 ? (
          <EmptyState title="No executed trades" subtitle="Trades will appear here after execution" icon={TrendingUp} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 px-2">Trade ID</th>
                  <th className="text-left py-2 px-2">Asset</th>
                  <th className="text-left py-2 px-2">Strategy</th>
                  <th className="text-right py-2 px-2">Size</th>
                  <th className="text-right py-2 px-2">Net PnL</th>
                  <th className="text-right py-2 px-2">bps</th>
                  <th className="text-center py-2 px-2">Mode</th>
                  <th className="text-right py-2 px-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {trades.filter(t => t.status === 'Closed').slice(0, 20).map(t => {
                  const pnl = Number(t.net_pnl || 0);
                  const isWin = pnl >= 0;
                  return (
                    <tr key={t.id} className="border-b border-border hover:bg-secondary/30 transition-colors">
                      <td className="py-2 px-2 text-primary">{t.trade_id}</td>
                      <td className="py-2 px-2 text-foreground">{t.asset}</td>
                      <td className="py-2 px-2 text-muted-foreground truncate max-w-[140px]">{t.strategy}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">{fmtUSD(t.allocated_capital || 0, 0)}</td>
                      <td className={`py-2 px-2 text-right font-bold ${isWin ? 'text-accent' : 'text-destructive'}`}>
                        <span className="flex items-center justify-end gap-1">
                          {isWin ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {isWin ? '+' : ''}${pnl.toFixed(2)}
                        </span>
                      </td>
                      <td className={`py-2 px-2 text-right ${isWin ? 'text-accent' : 'text-destructive'}`}>
                        {Number(t.net_pnl_bps || 0).toFixed(1)}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${t.mode === 'live' ? 'bg-accent/10 text-accent' : 'bg-muted text-muted-foreground'}`}>
                          {t.mode || 'paper'}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-muted-foreground">
                        {timeAgo(t.exit_timestamp || t.created_date)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}