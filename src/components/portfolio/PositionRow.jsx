import React from 'react';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function PositionRow({ position }) {
  const currentVal = (position.shares || 0) * (position.current_price || position.avg_price || 0);
  const costBasis = (position.shares || 0) * (position.avg_price || 0);
  const pnl = currentVal - costBasis;
  const pnlPercent = costBasis > 0 ? ((pnl / costBasis) * 100).toFixed(1) : 0;
  const isProfit = pnl >= 0;

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:border-primary/20 transition-all">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-mono font-bold ${
        position.side === 'yes'
          ? 'bg-accent/10 text-accent'
          : 'bg-destructive/10 text-destructive'
      }`}>
        {position.side === 'yes' ? 'YES' : 'NO'}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{position.market_title}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-muted-foreground font-mono">
            {position.shares} shares @ {Math.round((position.avg_price || 0) * 100)}¢
          </span>
          <Badge variant="outline" className="text-[10px] border-border">{position.status || 'open'}</Badge>
        </div>
      </div>

      <div className="text-right">
        <p className="text-sm font-mono font-bold text-foreground">${currentVal.toFixed(2)}</p>
        <div className={`flex items-center gap-1 justify-end text-xs font-mono ${
          isProfit ? 'text-accent' : 'text-destructive'
        }`}>
          {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {isProfit ? '+' : ''}{pnlPercent}% (${pnl.toFixed(2)})
        </div>
      </div>
    </div>
  );
}