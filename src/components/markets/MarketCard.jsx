import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, Users, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';

const categoryIcons = {
  politics: '🏛️',
  crypto: '₿',
  sports: '⚽',
  entertainment: '🎬',
  science: '🔬',
  economics: '📈',
  world: '🌍',
};

export default function MarketCard({ market, onTrade, onSelect }) {
  const yesPercent = Math.round((market.yes_price || 0) * 100);
  const noPercent = 100 - yesPercent;

  return (
    <div
      className="rounded-xl border border-border bg-card overflow-hidden hover:border-primary/20 transition-all duration-300 group cursor-pointer"
      onClick={() => onSelect && onSelect(market)}
    >
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <span className="text-xl">{categoryIcons[market.category] || '📊'}</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground leading-snug group-hover:text-primary transition-colors">
              {market.title}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <Badge variant="outline" className="text-[10px] font-mono border-border text-muted-foreground">
                {market.category}
              </Badge>
              {market.end_date && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {format(new Date(market.end_date), 'MMM d, yyyy')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Price display */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-lg bg-accent/5 border border-accent/20 p-3 text-center">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Yes</p>
            <p className="text-xl font-mono font-bold text-accent">{yesPercent}¢</p>
          </div>
          <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3 text-center">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">No</p>
            <p className="text-xl font-mono font-bold text-destructive">{noPercent}¢</p>
          </div>
        </div>

        {/* Volume bar */}
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden mb-4">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-primary"
            style={{ width: `${yesPercent}%` }}
          />
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-4">
          <span className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            Vol: ${(market.volume || 0) >= 1000000
              ? `${((market.volume || 0) / 1000000).toFixed(1)}M`
              : `${((market.volume || 0) / 1000).toFixed(0)}K`}
          </span>
          <span>Liq: ${((market.liquidity || 0) / 1000).toFixed(0)}K</span>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            className="bg-accent/10 text-accent hover:bg-accent/20 border border-accent/20 font-mono text-xs"
            onClick={(e) => { e.stopPropagation(); onTrade(market, 'yes'); }}
          >
            Buy Yes {yesPercent}¢
          </Button>
          <Button
            size="sm"
            className="bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 font-mono text-xs"
            onClick={(e) => { e.stopPropagation(); onTrade(market, 'no'); }}
          >
            Buy No {noPercent}¢
          </Button>
        </div>
      </div>
    </div>
  );
}