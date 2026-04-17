import React from 'react';
import { format } from 'date-fns';
import { TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function RecentTrades({ trades }) {
  if (!trades || trades.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Recent Bot Trades</h3>
        <p className="text-sm text-muted-foreground text-center py-6">No trades yet — start the bot</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Recent Bot Trades</h3>
      <div className="space-y-2">
        {trades.slice(0, 8).map((t) => {
          const isWin = t.outcome === 'win';
          const isPending = t.outcome === 'pending';
          const pnl = t.pnl_usdc || 0;
          return (
            <div key={t.id} className="flex items-center gap-3 py-1.5 border-b border-border/40 last:border-0">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                isPending ? 'bg-primary/10' : isWin ? 'bg-accent/10' : 'bg-destructive/10'
              }`}>
                {isPending
                  ? <Clock className="w-3.5 h-3.5 text-primary" />
                  : isWin
                    ? <TrendingUp className="w-3.5 h-3.5 text-accent" />
                    : <TrendingDown className="w-3.5 h-3.5 text-destructive" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono font-medium text-foreground truncate">
                  <span className={`mr-1 px-1 py-0.5 rounded text-[9px] font-bold ${t.asset === 'BTC' ? 'bg-chart-4/10 text-chart-4' : 'bg-primary/10 text-primary'}`}>{t.asset}</span>
                  {t.contract_type?.replace(/_/g, ' ')}
                </p>
                <p className="text-[10px] text-muted-foreground font-mono">
                  {t.side?.toUpperCase()} · {t.entry_price != null ? `${Math.round(t.entry_price*100)}¢` : '–'} · {t.size_usdc ? `$${t.size_usdc.toFixed(1)}` : ''}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-xs font-mono font-bold ${isPending ? 'text-primary' : pnl >= 0 ? 'text-accent' : 'text-destructive'}`}>
                  {isPending ? 'OPEN' : `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`}
                </p>
                <p className="text-[9px] text-muted-foreground">
                  {t.created_date ? format(new Date(t.created_date), 'MMM d HH:mm') : ''}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}