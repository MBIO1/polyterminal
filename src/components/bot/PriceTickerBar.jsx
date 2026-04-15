import React from 'react';
import { TrendingUp, TrendingDown, Wifi } from 'lucide-react';

export default function PriceTickerBar({ btc, eth, connected }) {
  return (
    <div className="flex items-center gap-6 px-4 py-2 bg-secondary/50 border-b border-border text-xs font-mono">
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-accent animate-pulse' : 'bg-chart-4 animate-pulse'}`} />
        <span className={connected ? 'text-accent font-semibold' : 'text-chart-4'}>
          {connected ? 'CoinGecko LIVE' : 'Connecting…'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">BTC</span>
        <span className="text-foreground font-bold">${btc?.price?.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
        <span className={`flex items-center gap-0.5 ${(btc?.change || 0) >= 0 ? 'text-accent' : 'text-destructive'}`}>
          {(btc?.change || 0) >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {Math.abs(btc?.change || 0).toFixed(3)}%
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">ETH</span>
        <span className="text-foreground font-bold">${eth?.price?.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
        <span className={`flex items-center gap-0.5 ${(eth?.change || 0) >= 0 ? 'text-accent' : 'text-destructive'}`}>
          {(eth?.change || 0) >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {Math.abs(eth?.change || 0).toFixed(3)}%
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1.5 text-muted-foreground">
        <Wifi className="w-3 h-3" />
        <span>Polymarket CLOB API</span>
      </div>
    </div>
  );
}