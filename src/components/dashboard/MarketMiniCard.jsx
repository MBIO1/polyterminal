import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

export default function MarketMiniCard({ market }) {
  const yesPercent = Math.round((market.yes_price || 0) * 100);
  const isHot = (market.volume || 0) > 500000;

  return (
    <Link
      to={`/markets?id=${market.id}`}
      className="block rounded-xl border border-border bg-card p-4 hover:border-primary/30 transition-all duration-200 group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 pr-3">
          <p className="text-sm font-medium text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {market.title}
          </p>
        </div>
        {isHot && (
          <span className="shrink-0 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-chart-4/10 text-chart-4">
            HOT
          </span>
        )}
      </div>
      
      <div className="flex items-end justify-between">
        <div>
          <span className="text-xs text-muted-foreground">YES</span>
          <p className={`text-lg font-mono font-bold ${yesPercent > 50 ? 'text-accent' : 'text-destructive'}`}>
            {yesPercent}¢
          </p>
        </div>
        <div className="text-right">
          <span className="text-xs text-muted-foreground">Vol</span>
          <p className="text-xs font-mono text-muted-foreground">
            ${(market.volume || 0) >= 1000000
              ? `${((market.volume || 0) / 1000000).toFixed(1)}M`
              : `${((market.volume || 0) / 1000).toFixed(0)}K`}
          </p>
        </div>
      </div>

      {/* Price bar */}
      <div className="mt-3 h-1 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-primary transition-all duration-500"
          style={{ width: `${yesPercent}%` }}
        />
      </div>
    </Link>
  );
}