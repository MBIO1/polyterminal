import React from 'react';
import { format } from 'date-fns';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

export default function RecentTrades({ trades }) {
  if (!trades || trades.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-medium text-muted-foreground mb-4">Recent Trades</h3>
        <p className="text-sm text-muted-foreground text-center py-6">No trades yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Recent Trades</h3>
      <div className="space-y-3">
        {trades.slice(0, 5).map((trade) => (
          <div key={trade.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              trade.action === 'buy' ? 'bg-accent/10' : 'bg-destructive/10'
            }`}>
              {trade.action === 'buy' ? (
                <ArrowUpRight className="w-4 h-4 text-accent" />
              ) : (
                <ArrowDownRight className="w-4 h-4 text-destructive" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{trade.market_title}</p>
              <p className="text-xs text-muted-foreground">
                {trade.action.toUpperCase()} {trade.shares} {trade.side?.toUpperCase()} @ {Math.round((trade.price || 0) * 100)}¢
              </p>
            </div>
            <div className="text-right">
              <p className={`text-sm font-mono font-medium ${trade.action === 'buy' ? 'text-accent' : 'text-destructive'}`}>
                {trade.action === 'buy' ? '-' : '+'}${(trade.total || 0).toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {trade.created_date ? format(new Date(trade.created_date), 'MMM d') : ''}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}