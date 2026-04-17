import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Wallet, TrendingUp, CheckCircle, Activity, TrendingDown, BarChart2, Percent } from 'lucide-react';
import StatCard from '@/components/dashboard/StatCard';
import PortfolioChart from '@/components/dashboard/PortfolioChart';
import RecentTrades from '@/components/dashboard/RecentTrades';
import { Link } from 'react-router-dom';
import { computeMetrics } from '@/lib/tradeMetrics';

const MiniMetric = ({ label, value, color = 'text-foreground', sub }) => (
  <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
    <p className="text-[10px] text-muted-foreground font-mono mb-1">{label}</p>
    <p className={`text-base font-bold font-mono ${color}`}>{value}</p>
    {sub && <p className="text-[9px] text-muted-foreground mt-0.5">{sub}</p>}
  </div>
);

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

  const m = useMemo(() => computeMetrics(trades, startingBalance), [trades, startingBalance]);

  const { totalPnl, portfolioValue, winRate, openCount } = {
    totalPnl: m.totalPnl,
    portfolioValue: m.portfolioValue,
    winRate: m.winRate.toFixed(1),
    openCount: m.pendingCount,
  };

  const pnlPct = startingBalance > 0 ? ((m.realizedPnl / startingBalance) * 100) : 0;
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

      {/* Stats Row 1 */}
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
          label="Realized P&L"
          value={`${m.realizedPnl >= 0 ? '+' : ''}$${m.realizedPnl.toFixed(2)}`}
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

      {/* Stats Row 2: Advanced metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MiniMetric
          label="Unrealized P&L"
          value={m.pendingCount > 0 ? `${m.unrealizedPnl >= 0 ? '+' : ''}$${m.unrealizedPnl.toFixed(2)}` : '—'}
          color={m.unrealizedPnl >= 0 ? 'text-primary' : 'text-chart-4'}
          sub={`${m.pendingCount} open`}
        />
        <MiniMetric
          label="Profit Factor"
          value={m.profitFactor >= 999 ? '∞' : m.profitFactor.toFixed(2)}
          color={m.profitFactor >= 1.5 ? 'text-accent' : m.profitFactor >= 1 ? 'text-chart-4' : 'text-destructive'}
          sub="win $ / loss $"
        />
        <MiniMetric
          label="Sharpe Ratio"
          value={m.sharpeRatio !== 0 ? m.sharpeRatio.toFixed(2) : '—'}
          color={m.sharpeRatio >= 1 ? 'text-accent' : m.sharpeRatio >= 0 ? 'text-chart-4' : 'text-destructive'}
          sub="annualized"
        />
        <MiniMetric
          label="Max Drawdown"
          value={`${m.maxDrawdown.toFixed(1)}%`}
          color={m.maxDrawdown < -20 ? 'text-destructive' : m.maxDrawdown < -10 ? 'text-chart-4' : 'text-foreground'}
          sub="peak-to-trough"
        />
        <MiniMetric
          label="📄 Paper Win Rate"
          value={m.paperWinRate !== null ? `${m.paperWinRate.toFixed(1)}%` : '—'}
          color={m.paperWinRate !== null ? (m.paperWinRate >= 50 ? 'text-accent' : 'text-destructive') : 'text-muted-foreground'}
          sub={m.paperCount > 0 ? `${m.paperCount} trades` : 'no paper trades'}
        />
        <MiniMetric
          label="💰 Live Win Rate"
          value={m.liveWinRate !== null ? `${m.liveWinRate.toFixed(1)}%` : '—'}
          color={m.liveWinRate !== null ? (m.liveWinRate >= 50 ? 'text-accent' : 'text-destructive') : 'text-muted-foreground'}
          sub={m.liveCount > 0 ? `${m.liveCount} trades` : 'no live trades'}
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