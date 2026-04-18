/**
 * BotManager — Real-time PnL for active BotTrades with trailing stop / take-profit UI.
 * Live prices sourced from priceSimulator (Binance + Coinbase + CoinGecko).
 * Bot auto-restarts after cooldown via autoRestartBot automation.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Bot, Activity, TrendingUp, TrendingDown, Shield, RefreshCw } from 'lucide-react';
import { startPriceSimulator, stopPriceSimulator } from '@/lib/priceSimulator';
import ActivePositionCard from '@/components/bot-manager/ActivePositionCard';

export default function BotManager() {
  const queryClient = useQueryClient();
  const [prices, setPrices] = useState({ btc: { price: 97500, prev: 97500 }, eth: { price: 3200, prev: 3200 } });
  const [actionLog, setActionLog] = useState([]);
  const [trades, setTrades] = useState([]);
  const [allTrades, setAllTrades] = useState([]);

  // Live price feed
  const handlePriceUpdate = useCallback((update) => {
    setPrices({ btc: update.btc, eth: update.eth });
  }, []);

  useEffect(() => {
    startPriceSimulator(handlePriceUpdate);
    return () => stopPriceSimulator(handlePriceUpdate);
  }, [handlePriceUpdate]);

  const { isLoading } = useQuery({
    queryKey: ['bot-manager-trades'],
    queryFn: () => base44.entities.BotTrade.filter({ outcome: 'pending' }),
    onSuccess: (data) => setTrades(data),
  });

  const { data: configs = [] } = useQuery({
    queryKey: ['bot-config'],
    queryFn: () => base44.entities.BotConfig.list(),
    refetchInterval: 10000,
  });

  useQuery({
    queryKey: ['bot-manager-all'],
    queryFn: () => base44.entities.BotTrade.list('-created_date', 100),
    onSuccess: (data) => setAllTrades(data),
  });

  // Real-time subscription
  useEffect(() => {
    const unsubscribe = base44.entities.BotTrade.subscribe((event) => {
      if (event.type === 'create') {
        setTrades(prev => [event.data, ...prev]);
        setAllTrades(prev => [event.data, ...prev].slice(0, 100));
      } else if (event.type === 'update') {
        setTrades(prev => {
          if (event.data.outcome === 'pending') {
            return prev.map(t => t.id === event.id ? event.data : t);
          }
          return prev.filter(t => t.id !== event.id);
        });
        setAllTrades(prev => prev.map(t => t.id === event.id ? event.data : t));
      }
    });
    return unsubscribe;
  }, []);

  const config = configs[0] || {};
  const resolved = allTrades.filter(t => t.outcome === 'win' || t.outcome === 'loss');
  const wins = resolved.filter(t => t.outcome === 'win').length;
  const winRate = resolved.length > 0 ? (wins / resolved.length * 100).toFixed(1) : '—';
  const totalPnl = allTrades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);

  const haltUntil = config.halt_until_ts || 0;
  const isHalted = config.kill_switch_active || (haltUntil > Date.now());
  const haltMinLeft = haltUntil > Date.now() ? Math.ceil((haltUntil - Date.now()) / 60000) : 0;

  const cancelMutation = useMutation({
    mutationFn: (trade) => base44.entities.BotTrade.update(trade.id, {
      outcome: 'cancelled',
      notes: `${trade.notes || ''} | ❌ Manually cancelled`,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bot-manager-trades'] });
      queryClient.invalidateQueries({ queryKey: ['bot-manager-all'] });
    },
  });

  const saveConfig = useMutation({
    mutationFn: (updates) => {
      if (configs.length > 0) return base44.entities.BotConfig.update(configs[0].id, updates);
      return base44.entities.BotConfig.create(updates);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bot-config'] }),
  });

  const handleCancel = (trade) => {
    cancelMutation.mutate(trade);
    setActionLog(prev => [{
      id: Date.now(),
      type: 'cancel',
      label: '❌ Cancelled',
      title: trade.market_title,
      asset: trade.asset,
      side: trade.side,
      size: trade.size_usdc,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }, ...prev].slice(0, 30));
    toast.success(`❌ Cancelled ${trade.asset} ${trade.side?.toUpperCase()} $${trade.size_usdc?.toFixed(2)}`);
  };

  const handleSetStop = (trade, stopPct) => {
    setActionLog(prev => [{
      id: Date.now(),
      type: 'stop',
      label: `🛑 SL Armed -${stopPct}%`,
      title: trade.market_title,
      asset: trade.asset,
      side: trade.side,
      size: trade.size_usdc,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }, ...prev].slice(0, 30));
    toast.info(`🛑 Stop loss armed at -${stopPct}% for ${trade.asset} position`);
  };

  const handleSetTakeProfit = (trade, tpPct) => {
    setActionLog(prev => [{
      id: Date.now(),
      type: 'tp',
      label: `✅ TP Armed +${tpPct}%`,
      title: trade.market_title,
      asset: trade.asset,
      side: trade.side,
      size: trade.size_usdc,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }, ...prev].slice(0, 30));
    toast.info(`✅ Take profit armed at +${tpPct}% for ${trade.asset} position`);
  };

  const handleManualRestart = async () => {
    await saveConfig.mutateAsync({ bot_running: true, halt_until_ts: 0, kill_switch_active: false });
    toast.success('▶️ Bot manually restarted');
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
            <p className="text-sm text-muted-foreground">Real-time positions · Stop loss &amp; take profit</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
          {/* Live price indicator */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card">
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="text-muted-foreground">BTC ${prices.btc?.price?.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
            <span className="text-border">·</span>
            <span className="text-muted-foreground">ETH ${prices.eth?.price?.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
          </div>
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

      {/* Halt / auto-restart banner */}
      {isHalted && (
        <div className="rounded-xl border border-chart-4/30 bg-chart-4/5 px-4 py-3 flex items-center justify-between gap-4">
          <div className="text-xs font-mono text-chart-4">
            {config.kill_switch_active
              ? '🛑 Kill switch active — bot is manually stopped'
              : `⏱ Bot halted — auto-restart in ~${haltMinLeft} min (autoRestartBot automation will resume it)`}
          </div>
          <button
            onClick={handleManualRestart}
            disabled={saveConfig.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-chart-4/40 text-chart-4 text-xs font-medium hover:bg-chart-4/10 transition-all shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Restart Now
          </button>
        </div>
      )}

      {/* Info */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs font-mono text-muted-foreground leading-relaxed">
        <span className="text-primary font-bold">Live PnL</span> is estimated from real-time Binance/Coinbase prices. Mark price = current CEX-implied probability vs entry. 
        Trailing stop &amp; take profit are <span className="text-foreground">client-side monitors</span> — arm them, then manually cancel when triggered (or let <span className="text-foreground">settlePendingTrades</span> settle at expiry).
        Bot auto-restarts after cooldown via the <span className="text-foreground">autoRestartBot</span> automation.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active positions */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Positions ({trades.length})</h2>
            {!isLoading && (
              <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full ${config.bot_running && !isHalted ? 'bg-accent/10 text-accent' : 'bg-muted/50 text-muted-foreground'}`}>
                {config.bot_running && !isHalted ? '▶ BOT RUNNING' : '⏸ BOT PAUSED'}
              </span>
            )}
          </div>

          {isLoading ? (
            Array(3).fill(0).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-card border border-border animate-pulse" />
            ))
          ) : trades.length === 0 ? (
            <div className="text-center py-16 rounded-xl border border-border bg-card">
              <Bot className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No active positions</p>
              <p className="text-xs text-muted-foreground mt-1">
                {config.bot_running && !isHalted ? 'Bot is running — new positions will appear here' : 'Start the bot from the Arb Bot dashboard'}
              </p>
            </div>
          ) : (
            trades.map(trade => (
              <ActivePositionCard
                key={trade.id}
                trade={trade}
                prices={prices}
                onCancel={handleCancel}
                onSetStop={handleSetStop}
                onSetTakeProfit={handleSetTakeProfit}
                cancelling={cancelMutation.isPending}
              />
            ))
          )}
        </div>

        {/* Right column: stats + action log */}
        <div className="space-y-4">
          {/* Session stats */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Session Stats</h2>
            {[
              { label: 'Active Positions', value: trades.length, color: 'text-primary' },
              { label: 'Win Rate (all time)', value: `${winRate}%`, color: parseFloat(winRate) >= 50 ? 'text-accent' : 'text-destructive' },
              { label: 'Total P&L', value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? 'text-accent' : 'text-destructive' },
              { label: 'Total Trades', value: allTrades.length, color: 'text-foreground' },
              { label: 'Bot Status', value: config.bot_running && !isHalted ? '▶ Running' : isHalted ? `⏱ Halted ${haltMinLeft}m` : '⏸ Paused', color: config.bot_running && !isHalted ? 'text-accent' : 'text-chart-4' },
              { label: 'Auto-Restart', value: isHalted && !config.kill_switch_active ? 'Armed' : config.kill_switch_active ? 'Disabled' : 'Ready', color: isHalted && !config.kill_switch_active ? 'text-primary' : 'text-muted-foreground' },
              { label: 'Mode', value: config.paper_trading !== false ? 'Paper' : 'Live', color: config.paper_trading !== false ? 'text-chart-4' : 'text-destructive' },
            ].map(item => (
              <div key={item.label} className="flex justify-between items-center py-1 border-b border-border/20 last:border-0">
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <span className={`text-xs font-mono font-bold ${item.color}`}>{item.value}</span>
              </div>
            ))}
          </div>

          {/* Action log */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Action Log</h2>
            {actionLog.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6 font-mono">No actions yet</p>
            ) : (
              actionLog.map(log => (
                <div key={log.id} className={`rounded-lg border px-3 py-2 space-y-1 ${
                  log.type === 'cancel' ? 'border-border/50 bg-secondary/20' :
                  log.type === 'stop'   ? 'border-destructive/20 bg-destructive/5' :
                                          'border-accent/20 bg-accent/5'
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[9px] font-mono font-bold ${
                      log.type === 'stop' ? 'text-destructive' : log.type === 'tp' ? 'text-accent' : 'text-muted-foreground'
                    }`}>{log.label}</span>
                    <span className="text-[9px] font-mono text-muted-foreground">{log.time}</span>
                  </div>
                  <p className="text-[10px] text-foreground font-medium truncate">{log.title}</p>
                  <p className="text-[9px] font-mono text-muted-foreground">{log.asset} {log.side?.toUpperCase()} · ${log.size?.toFixed(2)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}