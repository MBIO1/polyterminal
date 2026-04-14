import React from 'react';
import { format } from 'date-fns';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';

export default function TradeLog({ trades, limit = 10 }) {
  const recent = [...(trades || [])].sort((a, b) =>
    new Date(b.created_date || 0) - new Date(a.created_date || 0)
  ).slice(0, limit);

  if (recent.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6 font-mono">No trades yet</p>;
  }

  return (
    <div className="space-y-1.5">
      {recent.map((trade, i) => {
        const pnl = trade.pnl_usdc || 0;
        const OutcomeIcon = trade.outcome === 'win' ? CheckCircle2 : trade.outcome === 'loss' ? XCircle : Clock;
        const outcomeColor = trade.outcome === 'win' ? 'text-accent' : trade.outcome === 'loss' ? 'text-destructive' : 'text-muted-foreground';

        return (
          <div key={trade.id || i} className="flex items-center gap-2 py-2 border-b border-border/30 last:border-0 text-[11px] font-mono">
            <OutcomeIcon className={`w-3.5 h-3.5 shrink-0 ${outcomeColor}`} />
            <div className="flex-1 min-w-0">
              <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-bold mr-1 ${
                trade.asset === 'BTC' ? 'bg-chart-4/10 text-chart-4' : 'bg-primary/10 text-primary'
              }`}>{trade.asset}</span>
              <span className="text-muted-foreground">{trade.contract_type?.replace('_', ' ')}</span>
              {' '}
              <span className={trade.side === 'yes' ? 'text-accent' : 'text-destructive'}>
                {trade.side?.toUpperCase()}
              </span>
              {' '}
              <span className="text-foreground">@ {Math.round((trade.entry_price || 0) * 100)}¢</span>
            </div>
            <div className="text-right shrink-0">
              <p className={`font-bold ${pnl > 0 ? 'text-accent' : pnl < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                {pnl !== 0 ? `${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
              </p>
              <p className="text-muted-foreground text-[9px]">
                {trade.created_date ? format(new Date(trade.created_date), 'HH:mm:ss') : ''}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}