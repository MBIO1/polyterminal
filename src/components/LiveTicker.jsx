import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Zap } from 'lucide-react';

export default function LiveTicker() {
  const [prices, setPrices] = useState({ btc: null, eth: null });
  const [changes, setChanges] = useState({ btc: null, eth: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const [btcRes, ethRes] = await Promise.all([
          fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
          fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT', { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
        ]);

        setPrices({
          btc: parseFloat(btcRes.lastPrice),
          eth: parseFloat(ethRes.lastPrice),
        });
        setChanges({
          btc: parseFloat(btcRes.priceChangePercent),
          eth: parseFloat(ethRes.priceChangePercent),
        });
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 5000);
    return () => clearInterval(interval);
  }, []);

  const PriceItem = ({ asset, price, change }) => {
    if (!price) return null;
    const isPositive = change >= 0;
    return (
      <div className="flex items-center gap-2 text-xs font-mono">
        <span className="text-muted-foreground">{asset}</span>
        <span className="font-bold text-foreground">${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
        <div className={`flex items-center gap-0.5 ${isPositive ? 'text-accent' : 'text-destructive'}`}>
          {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          <span>{Math.abs(change).toFixed(2)}%</span>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/40 border border-border">
        <Zap className="w-3.5 h-3.5 text-muted-foreground animate-pulse" />
        <span className="text-xs text-muted-foreground font-mono">Loading prices…</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 px-4 py-2 rounded-lg bg-secondary/30 border border-border/50">
      <div className="flex items-center gap-0.5">
        <Zap className="w-3.5 h-3.5 text-chart-4" />
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Live</span>
      </div>
      <div className="flex items-center gap-5">
        <PriceItem asset="BTC" price={prices.btc} change={changes.btc} />
        <div className="w-px h-4 bg-border/30" />
        <PriceItem asset="ETH" price={prices.eth} change={changes.eth} />
      </div>
    </div>
  );
}