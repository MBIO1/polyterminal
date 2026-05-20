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
import BotDiagnosticCard from '@/components/dashboard/BotDiagnosticCard';

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
  const [botStatus, setBotStatus] = useState('unknown');
  const [arbConfig, setArbConfig] = useState(null);


  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      // Load trades
      const trades = await base44.entities.ArbTrade.list('-created_date', 50);
      setRecentTrades(trades.slice(0, 5));

      const totalPnl = trades.reduce((sum, t) => sum + (t.net_pnl || 0), 0);
      const activeTrades = trades.filter(t => t.status === 'Open').length;

      // Load signals
      const signals = await base44.entities.ArbSignal.list('-received_time', 10);
      setRecentSignals(signals);

      // Calculate win rate
      const closedTrades = trades.filter(t => t.status === 'Closed');
      const winningTrades = closedTrades.filter(t => (t.net_pnl || 0) > 0);
      const winRate = closedTrades.length > 0
        ? (winningTrades.length / closedTrades.length) * 100
        : 0;

      // Load latest heartbeat for bot status
      try {
        const hb = await base44.entities.ArbHeartbeat.list('-snapshot_time', 1);
        if (hb.length === 0) {
          setBotStatus('unknown');
        } else {
          const latest = hb[0];
          const ageMs = Date.now() - new Date(latest.snapshot_time).getTime();
          const stale = ageMs > 3 * 60 * 1000; // >3 min = stale
          const zeroEvals = (latest.evaluations || 0) === 0;
          const highReject = latest.evaluations > 0 && (latest.rejected_fillable || 0) / latest.evaluations > 0.5;
          setBotStatus(stale || zeroEvals || highReject ? 'alert' : 'ok');
        }
      } catch (_) {
        setBotStatus('unknown');
      }

      setStrategyPnl(trades); // pass raw trades to component

      // Load ArbConfig for drawdown gauge + bot controls
      try {
        const configs = await base44.entities.ArbConfig.list('-created_date', 1);
        if (configs.length > 0) setArbConfig(configs[0]);
      } catch (_) {}


      setStats({
        totalPnl,
        activeTrades,
        signalsToday: signals.length,
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
            botStatus === 'ok' ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : botStatus === 'alert' ? 'bg-red-500/10 border-red-500/30 text-red-400'
            : 'bg-muted border-border text-muted-foreground'
          }`}>
            <Cpu className="w-4 h-4" />
            <span className={`w-2 h-2 rounded-full ${botStatus === 'ok' ? 'bg-green-400 animate-pulse' : botStatus === 'alert' ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`} />
            {botStatus === 'ok' ? 'Bot Online' : botStatus === 'alert' ? 'Bot Issue' : 'No Heartbeat'}
          </div>
          <BotControls config={arbConfig} onUpdated={loadDashboardData} />
          <Button onClick={loadDashboardData} variant="outline" size="sm">
            <Activity className="w-4 h-4 mr-2" />Refresh
          </Button>
        </div>
      </div>

      {/* Bot Diagnostics — heartbeat + token auth status */}
      <BotDiagnosticCard />

      {/* Drawdown Gauge + Balance */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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