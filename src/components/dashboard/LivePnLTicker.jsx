import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { TrendingUp, TrendingDown, Zap } from 'lucide-react';

export default function LivePnLTicker() {
  const [displayPnl, setDisplayPnl] = useState(0);
  const [trend, setTrend] = useState('neutral');

  // Poll BotTrade data every 5 seconds
  const { data: trades = [] } = useQuery({
    queryKey: ['live-pnl-ticker'],
    queryFn: () => base44.entities.BotTrade.list('-created_date', 200),
    refetchInterval: 5000,
  });

  // Poll config every 5 seconds for starting balance
  const { data: configs = [] } = useQuery({
    queryKey: ['live-config-ticker'],
    queryFn: () => base44.entities.BotConfig.list(),
    refetchInterval: 5000,
  });

  useEffect(() => {
    const startingBalance = configs[0]?.starting_balance || 1000;
    const totalPnl = trades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);

    setTrend(totalPnl > displayPnl ? 'up' : totalPnl < displayPnl ? 'down' : 'neutral');
    setDisplayPnl(totalPnl);
  }, [trades, configs, displayPnl]);

  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Zap;
  const color = displayPnl >= 0
    ? 'text-accent'
    : displayPnl < -100
    ? 'text-destructive'
    : 'text-chart-4';

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-secondary/30 backdrop-blur-sm">
      <Icon className={`w-4 h-4 ${color} ${trend !== 'neutral' ? 'animate-pulse' : ''}`} />
      <div className="flex flex-col">
        <span className="text-[10px] text-muted-foreground font-mono">Live P&L</span>
        <span className={`text-sm font-bold font-mono ${color}`}>
          {displayPnl >= 0 ? '+' : ''}${displayPnl.toFixed(2)}
        </span>
      </div>
    </div>
  );
}