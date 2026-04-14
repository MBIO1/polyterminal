import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Wallet, TrendingUp, BarChart3, Layers } from 'lucide-react';
import StatCard from '@/components/dashboard/StatCard';
import PortfolioChart from '@/components/dashboard/PortfolioChart';
import MarketMiniCard from '@/components/dashboard/MarketMiniCard';
import RecentTrades from '@/components/dashboard/RecentTrades';

export default function Dashboard() {
  const { data: markets = [] } = useQuery({
    queryKey: ['markets'],
    queryFn: () => base44.entities.Market.list('-volume', 6),
  });

  const { data: positions = [] } = useQuery({
    queryKey: ['positions'],
    queryFn: () => base44.entities.Position.list(),
  });

  const { data: trades = [] } = useQuery({
    queryKey: ['trades-recent'],
    queryFn: () => base44.entities.Trade.list('-created_date', 5),
  });

  const totalValue = positions.reduce((sum, p) => sum + (p.shares || 0) * (p.current_price || p.avg_price || 0), 0);
  const totalCost = positions.reduce((sum, p) => sum + (p.shares || 0) * (p.avg_price || 0), 0);
  const totalPnl = totalValue - totalCost;
  const pnlPercent = totalCost > 0 ? ((totalPnl / totalCost) * 100).toFixed(1) : 0;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Your Polymarket trading overview</p>
        </div>
        <div className="flex items-center gap-2 bg-accent/10 px-3 py-1.5 rounded-full">
          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-xs font-mono text-accent">Markets Live</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Portfolio Value"
          value={`$${totalValue.toFixed(2)}`}
          change={Number(pnlPercent)}
          changeLabel="all time"
          icon={Wallet}
          highlight
        />
        <StatCard
          label="Open Positions"
          value={positions.filter(p => p.status === 'open').length}
          icon={Layers}
        />
        <StatCard
          label="Total P&L"
          value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`}
          change={Number(pnlPercent)}
          icon={TrendingUp}
        />
        <StatCard
          label="Active Markets"
          value={markets.filter(m => m.status === 'active').length}
          icon={BarChart3}
        />
      </div>

      {/* Chart + Recent Trades */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PortfolioChart />
        </div>
        <div>
          <RecentTrades trades={trades} />
        </div>
      </div>

      {/* Trending Markets */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Trending Markets</h2>
          <a href="/markets" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors">
            View All →
          </a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {markets.slice(0, 6).map((market) => (
            <MarketMiniCard key={market.id} market={market} />
          ))}
          {markets.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground text-sm">
              No markets available yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}