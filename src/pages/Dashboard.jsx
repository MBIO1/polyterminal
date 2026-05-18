import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowUpRight, 
  TrendingUp, 
  Activity, 
  DollarSign,
  BarChart3,
  TableIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';

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

      // Group P&L by strategy
      const strategyMap = {};
      for (const t of trades) {
        const key = t.strategy || 'Unknown';
        if (!strategyMap[key]) strategyMap[key] = { strategy: key, pnl: 0, trades: 0, wins: 0 };
        strategyMap[key].pnl += t.net_pnl || 0;
        strategyMap[key].trades += 1;
        if ((t.net_pnl || 0) > 0) strategyMap[key].wins += 1;
      }
      setStrategyPnl(Object.values(strategyMap).sort((a, b) => b.pnl - a.pnl));

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your arbitrage trading performance</p>
        </div>
        <Button onClick={loadDashboardData} variant="outline">
          <Activity className="w-4 h-4 mr-2" />Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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

      {/* P&L by Strategy */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <TableIcon className="h-4 w-4 text-muted-foreground" />
          <CardTitle>P&L by Strategy</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : strategyPnl.length === 0 ? (
            <p className="text-muted-foreground">No trade data yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-left">
                  <th className="pb-2 font-medium">Strategy</th>
                  <th className="pb-2 font-medium text-right">Trades</th>
                  <th className="pb-2 font-medium text-right">Win Rate</th>
                  <th className="pb-2 font-medium text-right">Net P&L</th>
                </tr>
              </thead>
              <tbody>
                {strategyPnl.map((row) => (
                  <tr key={row.strategy} className="border-b border-border/50 hover:bg-secondary/30">
                    <td className="py-2 font-medium">{row.strategy}</td>
                    <td className="py-2 text-right text-muted-foreground">{row.trades}</td>
                    <td className="py-2 text-right text-muted-foreground">
                      {row.trades > 0 ? ((row.wins / row.trades) * 100).toFixed(0) : 0}%
                    </td>
                    <td className={`py-2 text-right font-mono font-semibold ${row.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {row.pnl >= 0 ? '+' : ''}${row.pnl.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

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