import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Bot, Shield, Target, Activity, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import PositionManagerRow from '@/components/bot-manager/PositionManagerRow';

export default function BotManager() {
  const queryClient = useQueryClient();
  const [sellLog, setSellLog] = useState([]);

  const { data: positions = [], isLoading } = useQuery({
    queryKey: ['positions'],
    queryFn: () => base44.entities.Position.list(),
  });

  const openPositions = positions.filter(p => p.status === 'open' || !p.status);

  const closeMutation = useMutation({
    mutationFn: async ({ position, price }) => {
      await base44.entities.Trade.create({
        market_id: position.market_id,
        market_title: position.market_title,
        side: position.side,
        action: 'sell',
        shares: position.shares,
        price,
        total: (position.shares || 0) * price,
      });
      await base44.entities.Position.update(position.id, { status: 'closed', current_price: price });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['trades-recent'] });
      queryClient.invalidateQueries({ queryKey: ['trades'] });
    },
  });

  const handleSell = useCallback((position, price, reason) => {
    const reasonLabel = reason === 'trailing_stop' ? '🛑 Trailing Stop' :
                        reason === 'take_profit'   ? '✅ Take Profit'   : '🤚 Manual Sell';

    setSellLog(prev => [{
      id: Date.now(),
      title: position.market_title,
      side: position.side,
      price: Math.round(price * 100),
      reason: reasonLabel,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      pnl: ((price - position.avg_price) * position.shares).toFixed(2),
    }, ...prev].slice(0, 20));

    closeMutation.mutate({ position, price });

    toast.success(`${reasonLabel} · ${position.market_title?.slice(0, 30)}... @ ${Math.round(price * 100)}¢`, {
      duration: 6000,
    });
  }, [closeMutation]);

  const armedCount = 0; // tracked locally in children

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Bot Manager</h1>
              <p className="text-sm text-muted-foreground">Automated stop-loss &amp; take-profit for open positions</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card">
            <Shield className="w-3.5 h-3.5 text-destructive" />
            <span className="text-muted-foreground">Trailing Stop</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card">
            <Target className="w-3.5 h-3.5 text-accent" />
            <span className="text-muted-foreground">Take Profit</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card">
            <Activity className="w-3.5 h-3.5 text-primary" />
            <span className="text-muted-foreground">{openPositions.length} positions</span>
          </div>
        </div>
      </div>

      {/* Info bar */}
      <div className="flex items-start gap-3 rounded-xl border border-chart-4/20 bg-chart-4/5 px-4 py-3">
        <AlertTriangle className="w-4 h-4 text-chart-4 mt-0.5 shrink-0" />
        <p className="text-xs font-mono text-muted-foreground leading-relaxed">
          All positions are <span className="text-accent font-bold">auto-monitored</span> from the moment they open. The bot continuously tracks live prices and automatically fires a market sell when the trailing stop (tracks peak) or take-profit is breached. You can pause any position manually.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Position list */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Open Positions</h2>

          {isLoading ? (
            Array(3).fill(0).map((_, i) => (
              <div key={i} className="h-56 rounded-xl bg-card border border-border animate-pulse" />
            ))
          ) : openPositions.length > 0 ? (
            openPositions.map(pos => (
              <PositionManagerRow key={pos.id} position={pos} onSell={handleSell} />
            ))
          ) : (
            <div className="text-center py-16 rounded-xl border border-border bg-card text-muted-foreground text-sm">
              No open positions — go to <a href="/markets" className="text-primary hover:underline">Markets</a> to trade
            </div>
          )}
        </div>

        {/* Execution log */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Execution Log</h2>
          <div className="rounded-xl border border-border bg-card p-4 space-y-2 min-h-[200px]">
            {sellLog.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8 font-mono">No executions yet</p>
            ) : (
              sellLog.map(log => (
                <div key={log.id} className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={`text-[9px] font-mono shrink-0 ${
                      log.side === 'yes' ? 'border-accent/30 text-accent' : 'border-destructive/30 text-destructive'
                    }`}>
                      {log.side?.toUpperCase()}
                    </Badge>
                    <span className="text-[10px] font-mono text-muted-foreground">{log.time}</span>
                  </div>
                  <p className="text-xs text-foreground font-medium truncate">{log.title}</p>
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-muted-foreground">{log.reason}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">@ {log.price}¢</span>
                      <span className={Number(log.pnl) >= 0 ? 'text-accent font-bold' : 'text-destructive font-bold'}>
                        {Number(log.pnl) >= 0 ? '+' : ''}${log.pnl}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}