import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowUpRight, 
  TrendingUp, 
  Activity, 
  DollarSign,
  BarChart3,
  Cpu,
} from 'lucide-react';
import BotControls from '@/components/arb/BotControls';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import StrategyPerformanceTable from '@/components/dashboard/StrategyPerformanceTable';
import DailyPnlChart from '@/components/dashboard/DailyPnlChart';
import DrawdownGauge from '@/components/dashboard/DrawdownGauge';
import BybitBalanceWidget from '@/components/dashboard/BybitBalanceWidget';
import SignalAcceptanceChart from '@/components/dashboard/SignalAcceptanceChart';
import ExecutionHealthCard from '@/components/dashboard/ExecutionHealthCard';
import LiveMarketChart from '@/components/dashboard/LiveMarketChart';
import ConnectionStatus from '@/components/dashboard/ConnectionStatus';

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalPnl: 0,
    activeTrades: 0,
    signalsToday: 0,
    winRate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [recentTrades, setRecentTrades] = useState([]);
  const [recentSignals, setRecentSignals] = useState([]);
  const [strategyPnl, setStrategyPnl] = useState([]);
  const [botStatus, setBotStatus] = useState('stopped');
  const [arbConfig, setArbConfig] = useState(null);


  useEffect(() => {
    loadDashboardData();
    
    // Subscribe to real-time updates for trades and signals
    const unsubscribeTrades = base44.entities.ArbTrade.subscribe((event) => {
      console.log('Trade update:', event.type);
      loadDashboardData();
    });
    
    const unsubscribeSignals = base44.entities.ArbSignal.subscribe((event) => {
      console.log('Signal update:', event.type);
      loadDashboardData();
    });
    
    const unsubscribeConfig = base44.entities.ArbConfig.subscribe((event) => {
      console.log('Config update:', event.type);
      loadDashboardData();
    });
    
    return () => {
      unsubscribeTrades();
      unsubscribeSignals();
      unsubscribeConfig();
    };
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      const [tradesRes, signalsRes, configsRes] = await Promise.allSettled([
        base44.entities.ArbTrade.list('-created_date', 50),
        base44.entities.ArbSignal.list('-received_time', 50),
        base44.entities.ArbConfig.list('-created_date', 1),
      ]);

      const trades = tradesRes.status === 'fulfilled' ? tradesRes.value : [];
      const allRecentSignals = signalsRes.status === 'fulfilled' ? signalsRes.value : [];
      const configs = configsRes.status === 'fulfilled' ? configsRes.value : [];

      if (tradesRes.status === 'rejected') console.error('Trades load error:', tradesRes.reason);
      if (signalsRes.status === 'rejected') console.error('Signals load error:', signalsRes.reason);
      if (configsRes.status === 'rejected') console.error('Config load error:', configsRes.reason);

      setRecentTrades(trades.slice(0, 5));

      // Only sum trades that have a real net_pnl recorded (not null)
      const tradesWithPnl = trades.filter(t => t.net_pnl != null && Number.isFinite(t.net_pnl));
      const totalPnl = tradesWithPnl.reduce((sum, t) => sum + Number(t.net_pnl), 0);
      const activeTrades = trades.filter(t => t.status === 'Open').length;

      // Load signals — only today's (UTC), since stat is "Signals Today"
      const todayStart = new Date(); todayStart.setUTCHours(0,0,0,0);
      const signalsToday = allRecentSignals.filter(s => {
        const t = new Date(s.received_time || s.created_date).getTime();
        return Number.isFinite(t) && t >= todayStart.getTime();
      });
      setRecentSignals(allRecentSignals.slice(0, 10));

      // Win rate: only count closed trades that have a numeric net_pnl recorded.
      // Excludes test trades, paper trades with null PnL, and stuck-Open trades.
      const closedTradesWithPnl = trades.filter(t =>
        t.status === 'Closed' && t.net_pnl != null && Number.isFinite(t.net_pnl)
      );
      const winningTrades = closedTradesWithPnl.filter(t => Number(t.net_pnl) > 0);
      const winRate = closedTradesWithPnl.length > 0
        ? (winningTrades.length / closedTradesWithPnl.length) * 100
        : 0;

      const cfg = configs?.[0] || null;
      setArbConfig(cfg);
      setStrategyPnl(trades);
      if (cfg?.kill_switch_active) setBotStatus('killswitch');
      else if (cfg?.bot_running) setBotStatus('running');
      else setBotStatus('stopped');


      setStats({
        totalPnl,
        activeTrades,
        signalsToday: signalsToday.length,
        winRate: winRate.toFixed(1),
      });
    } catch (error) {
      console.error('Dashboard load error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your arbitrage trading performance</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${
            botStatus === 'running' ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : botStatus === 'killswitch' ? 'bg-red-500/10 border-red-500/30 text-red-400'
            : 'bg-muted border-border text-muted-foreground'
          }`}>
            <Cpu className="w-4 h-4" />
            <span className={`w-2 h-2 rounded-full ${botStatus === 'running' ? 'bg-green-400 animate-pulse' : botStatus === 'killswitch' ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`} />
            {botStatus === 'running' ? 'Bot Running' : botStatus === 'killswitch' ? 'Kill Switch' : 'Bot Stopped'}
          </div>
          <BotControls config={arbConfig} onUpdated={loadDashboardData} />
          <Button onClick={loadDashboardData} variant="outline" size="sm">
            <Activity className="w-4 h-4 mr-2" />Refresh
          </Button>
        </div>
      </div>

      {/* Live Market Chart — Bybit BTC/ETH prices + spread + signals */}
      <LiveMarketChart activeTrades={strategyPnl.filter(t => t.status === 'Open')} />

      {/* Connection Status Widget + Drawdown + Balance */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-1">
          <ConnectionStatus />
        </div>
        <DrawdownGauge trades={strategyPnl} config={arbConfig} />
        <BybitBalanceWidget />

        {/* Stats Cards */}
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total P&L</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ${stats.totalPnl.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">Lifetime profit/loss</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Trades</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeTrades}</div>
            <p className="text-xs text-muted-foreground">Currently open</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Signals Today</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.signalsToday}</div>
            <p className="text-xs text-muted-foreground">Detected opportunities</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.winRate}%</div>
            <p className="text-xs text-muted-foreground">Closed trades</p>
          </CardContent>
        </Card>
        </div>
      </div>

      {/* Daily P&L Chart */}
      <DailyPnlChart trades={strategyPnl} />

      {/* Signal Acceptance — last 24h */}
      <SignalAcceptanceChart />

      {/* Execution Health — last 24h */}
      <ExecutionHealthCard />

      {/* Strategy Performance Table */}
      <StrategyPerformanceTable trades={strategyPnl} />

      {/* Recent Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Trades</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : recentTrades.length === 0 ? (
              <p className="text-muted-foreground">No trades yet</p>
            ) : (
              <div className="space-y-2">
                {recentTrades.map((trade) => (
                  <div key={trade.id} className="flex items-center justify-between p-2 bg-secondary rounded">
                    <div>
                      <div className="font-medium">{trade.asset} — {trade.strategy}</div>
                      <div className="text-sm text-muted-foreground">{trade.status}</div>
                    </div>
                    <div className={`font-mono ${(trade.net_pnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      ${(trade.net_pnl || 0).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link to="/trades">
              <Button variant="ghost" className="w-full mt-4">View All Trades →</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Signals</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : recentSignals.length === 0 ? (
              <p className="text-muted-foreground">No signals yet</p>
            ) : (
              <div className="space-y-2">
                {recentSignals.map((signal) => (
                  <div key={signal.id} className="flex items-center justify-between p-2 bg-secondary rounded">
                    <div>
                      <div className="font-medium">{signal.pair}</div>
                      <div className="text-sm text-muted-foreground">{signal.net_edge_bps?.toFixed(2)} bps</div>
                    </div>
                    <Badge variant={signal.status === 'executed' ? 'default' : 'secondary'}>
                      {signal.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
            <Link to="/signals">
              <Button variant="ghost" className="w-full mt-4">View All Signals →</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}