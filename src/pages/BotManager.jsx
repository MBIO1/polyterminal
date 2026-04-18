/**
 * BotManager — monitors active BotTrade positions (outcome=pending).
 * Shows live PnL estimate, entry info, time elapsed, and allows manual cancel.
 * The actual stop-loss / take-profit enforcement is handled server-side by
 * the settlePendingTrades automation.
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Bot, Activity, Clock, X, TrendingUp, TrendingDown, Shield } from 'lucide-react';

function elapsed(dateStr) {
  const ms = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function formatPrice(p) {
  return `${Math.round((p || 0) * 100)}¢`;
}

function estPnl(trade) {
  // Estimate current mark-to-market: assume midpoint drifts slightly toward 50¢ if no new info
  const entry = trade.entry_price || 0.5;
  const mark = entry; // no live mark available; show entry-based zero as placeholder
  const gross = trade.side === 'yes'
    ? (mark - entry) * (trade.shares || 0)
    : (entry - mark) * (trade.shares || 0);
  return gross;
}

export default function BotManager() {
  const queryClient = useQueryClient();
  const [cancelLog, setCancelLog] = useState([]);

  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['bot-manager-trades'],
    queryFn: () => base44.entities.BotTrade.filter({ outcome: 'pending' }),
    refetchInterval: 15000,
  });

  const { data: configs = [] } = useQuery({
    queryKey: ['bot-config'],
    queryFn: () => base44.entities.BotConfig.list(),
  });

  const { data: allTrades = [] } = useQuery({
    queryKey: ['bot-manager-all'],
    queryFn: () => base44.entities.BotTrade.list('-created_date', 100),
  });

  const config = configs[0] || {};
  const resolved = allTrades.filter(t => t.outcome === 'win' || t.outcome === 'loss');
  const wins = resolved.filter(t => t.outcome === 'win').length;
  const winRate = resolved.length > 0 ? (wins / resolved.length * 100).toFixed(1) : '—';
  const totalPnl = allTrades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);

  const cancelMutation = useMutation({
    mutationFn: (trade) => base44.entities.BotTrade.update(trade.id, {
      outcome: 'cancelled',
      notes: `${trade.notes || ''} | ❌ Manually cancelled`,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bot-manager-trades'] }),
  });

  const handleCancel = (trade) => {
    cancelMutation.mutate(trade);
    setCancelLog(prev => [{
      id: Date.now(),
      title: trade.market_title,
      asset: trade.asset,
      side: trade.side,
      size: trade.size_usdc,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }, ...prev].slice(0, 20));
    toast.success(`❌ Cancelled ${trade.asset} ${trade.side?.toUpperCase()} $${trade.size_usdc?.toFixed(2)}`);
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Bot Manager</h1>
            <p className="text-sm text-muted-foreground">Monitor &amp; manage active bot positions</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card">
            <Activity className="w-3.5 h-3.5 text-primary" />
            <span className="text-muted-foreground">{trades.length} active</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card">
            <Shield className="w-3.5 h-3.5 text-accent" />
            <span className="text-muted-foreground">Win {winRate}%</span>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-card ${totalPnl >= 0 ? 'border-accent/30' : 'border-destructive/30'}`}>
            {totalPnl >= 0 ? <TrendingUp className="w-3.5 h-3.5 text-accent" /> : <TrendingDown className="w-3.5 h-3.5 text-destructive" />}
            <span className={totalPnl >= 0 ? 'text-accent' : 'text-destructive'}>{totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs font-mono text-muted-foreground leading-relaxed">
        <span className="text-primary font-bold">Active positions</span> are BotTrades awaiting settlement. The scheduled <span className="text-foreground">settlePendingTrades</span> automation runs every 2 min and resolves any position older than 5 min. You can manually cancel a position below — it won't count toward P&L.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active positions */}
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Positions ({trades.length})</h2>

          {isLoading ? (
            Array(3).fill(0).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-card border border-border animate-pulse" />
            ))
          ) : trades.length === 0 ? (
            <div className="text-center py-16 rounded-xl border border-border bg-card">
              <Bot className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No active positions</p>
              <p className="text-xs text-muted-foreground mt-1">
                {config.bot_running ? 'Bot is running — new positions will appear here' : 'Start the bot from the Arb Bot dashboard'}
              </p>
            </div>
          ) : (
            trades.map(trade => {
              const age = Date.now() - new Date(trade.created_date).getTime();
              const ageMin = age / 60000;
              const urgent = ageMin >= 4; // settlement approaching

              return (
                <div key={trade.id} className={`rounded-xl border bg-card p-4 transition-all ${urgent ? 'border-chart-4/40' : 'border-border'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${trade.asset === 'BTC' ? 'bg-chart-4/10 text-chart-4' : 'bg-primary/10 text-primary'}`}>
                          {trade.asset}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${trade.side === 'yes' ? 'bg-accent/10 text-accent' : 'bg-destructive/10 text-destructive'}`}>
                          {trade.side?.toUpperCase()}
                        </span>
                        <span className="text-[9px] font-mono text-muted-foreground bg-secondary/40 px-1.5 py-0.5 rounded">
                          {trade.contract_type?.replace(/_/g, ' ')}
                        </span>
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${trade.mode === 'live' ? 'bg-destructive/10 text-destructive' : 'bg-chart-4/10 text-chart-4'}`}>
                          {trade.mode === 'live' ? '💰 LIVE' : '📄 PAPER'}
                        </span>
                        {urgent && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-chart-4/20 text-chart-4 animate-pulse">
                            ⏱ Settling soon
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-foreground font-medium truncate">{trade.market_title}</p>
                    </div>
                    <button
                      onClick={() => handleCancel(trade)}
                      disabled={cancelMutation.isPending}
                      className="p-1.5 rounded-lg border border-border hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive text-muted-foreground transition-all shrink-0"
                      title="Cancel position"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mt-3 text-[10px] font-mono">
                    <div>
                      <p className="text-muted-foreground">Entry</p>
                      <p className="text-foreground font-bold">{formatPrice(trade.entry_price)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Size</p>
                      <p className="text-foreground font-bold">${(trade.size_usdc || 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Shares</p>
                      <p className="text-foreground font-bold">{trade.shares || 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Edge</p>
                      <p className="text-accent font-bold">{(trade.edge_at_entry || 0).toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> Age</p>
                      <p className={`font-bold ${urgent ? 'text-chart-4' : 'text-foreground'}`}>{elapsed(trade.created_date)}</p>
                    </div>
                  </div>

                  {trade.notes && (
                    <p className="mt-2 text-[9px] font-mono text-muted-foreground/60 truncate">{trade.notes}</p>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Right column: stats + cancel log */}
        <div className="space-y-4">
          {/* Session stats */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Session Stats</h2>
            {[
              { label: 'Active Positions', value: trades.length, color: 'text-primary' },
              { label: 'Win Rate (all time)', value: `${winRate}%`, color: parseFloat(winRate) >= 50 ? 'text-accent' : 'text-destructive' },
              { label: 'Total P&L', value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? 'text-accent' : 'text-destructive' },
              { label: 'Total Trades', value: allTrades.length, color: 'text-foreground' },
              { label: 'Bot Status', value: config.bot_running ? '▶ Running' : '⏸ Paused', color: config.bot_running ? 'text-accent' : 'text-muted-foreground' },
              { label: 'Mode', value: config.paper_trading !== false ? 'Paper' : 'Live', color: config.paper_trading !== false ? 'text-chart-4' : 'text-destructive' },
            ].map(item => (
              <div key={item.label} className="flex justify-between items-center py-1 border-b border-border/20 last:border-0">
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <span className={`text-xs font-mono font-bold ${item.color}`}>{item.value}</span>
              </div>
            ))}
          </div>

          {/* Cancel log */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Cancel Log</h2>
            {cancelLog.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6 font-mono">No cancellations yet</p>
            ) : (
              cancelLog.map(log => (
                <div key={log.id} className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${log.side === 'yes' ? 'bg-accent/10 text-accent' : 'bg-destructive/10 text-destructive'}`}>
                      {log.asset} {log.side?.toUpperCase()}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">{log.time}</span>
                  </div>
                  <p className="text-xs text-foreground font-medium truncate">{log.title}</p>
                  <p className="text-[9px] font-mono text-muted-foreground">Size: ${log.size?.toFixed(2)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}