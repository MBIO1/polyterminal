import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Wallet, TrendingUp, BarChart3, CheckCircle, Activity } from 'lucide-react';
import StatCard from '@/components/dashboard/StatCard';
import PortfolioChart from '@/components/dashboard/PortfolioChart';
import RecentTrades from '@/components/dashboard/RecentTrades';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const { data: configs = [] } = useQuery({
    queryKey: ['bot-config'],
    queryFn: () => base44.entities.BotConfig.list(),
    refetchInterval: 10000,
  });

  const { data: trades = [] } = useQuery({
    queryKey: ['bot-trades-dashboard'],
    queryFn: () => base44.entities.BotTrade.list('-created_date', 200),
    refetchInterval: 15000,
  });

  const config = configs[0] || {};
  const startingBalance = config.starting_balance || 1000;

  const { totalPnl, portfolioValue, winRate, openCount } = useMemo(() => {
    const totalPnl = trades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
    const portfolioValue = startingBalance + totalPnl;
    const resolved = trades.filter(t => t.outcome === 'win' || t.outcome === 'loss');
    const wins = resolved.filter(t => t.outcome === 'win').length;
    const winRate = resolved.length > 0 ? (wins / resolved.length * 100).toFixed(1) : '0.0';
    const openCount = trades.filter(t => t.outcome === 'pending').length;
    return { totalPnl, portfolioValue, winRate, openCount };
  }, [trades, startingBalance]);

  const pnlPct = startingBalance > 0 ? ((totalPnl / startingBalance) * 100) : 0;
  const isRunning = config.bot_running && !config.kill_switch_active;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Overview</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {trades.length} total bot trades · {config.paper_trading !== false ? '📄 Paper' : '💰 Live'} mode
          </p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${isRunning ? 'bg-accent/10' : 'bg-muted/50'}`}>
          <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-accent animate-pulse' : 'bg-muted-foreground'}`} />
          <span className={`text-xs font-mono ${isRunning ? 'text-accent' : 'text-muted-foreground'}`}>
            {isRunning ? 'Bot Running' : 'Bot Paused'}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Portfolio Value"
          value={`$${portfolioValue.toFixed(2)}`}
          change={Number(pnlPct.toFixed(1))}
          changeLabel="vs start"
          icon={Wallet}
          highlight
        />
        <StatCard
          label="Total P&L"
          value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`}
          change={Number(pnlPct.toFixed(1))}
          icon={TrendingUp}
        />
        <StatCard
          label="Win Rate"
          value={`${winRate}%`}
          icon={CheckCircle}
        />
        <StatCard
          label="Open Trades"
          value={openCount}
          icon={Activity}
        />
      </div>

      {/* Chart + Recent Trades */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PortfolioChart />
        </div>
        <div>
          <RecentTrades trades={trades.slice(0, 8)} />
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Bot Dashboard', href: '/', desc: 'Scanner & controls' },
          { label: 'Analytics', href: '/analytics', desc: 'Charts & backtest' },
          { label: 'Trade Log', href: '/trades', desc: 'Filtered history' },
          { label: 'Portfolio', href: '/portfolio', desc: 'P&L breakdown' },
        ].map(l => (
          <Link key={l.href} to={l.href}
            className="rounded-xl border border-border bg-card p-4 hover:border-primary/40 hover:bg-secondary/50 transition-all">
            <p className="text-sm font-semibold text-foreground">{l.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{l.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}