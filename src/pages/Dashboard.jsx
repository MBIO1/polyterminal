import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowUpRight, 
  TrendingUp, 
  Activity, 
  DollarSign,
  BarChart3,
  AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { analyticsApi, tradesApi, signalsApi } from '@/api/proxyClient';

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

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      // Load trades
      const tradesRes = await tradesApi.getAll();
      const trades = tradesRes.trades || [];
      setRecentTrades(trades.slice(0, 5));
      
      // Calculate stats
      const totalPnl = trades.reduce((sum, t) => sum + (t.net_pnl || 0), 0);
      const activeTrades = trades.filter(t => t.status === 'Open').length;
      
      // Load signals
      const signalsRes = await signalsApi.getRecent(10);
      const signals = signalsRes.signals || [];
      setRecentSignals(signals);
      
      // Calculate win rate
      const closedTrades = trades.filter(t => t.status === 'Closed');
      const winningTrades = closedTrades.filter(t => (t.net_pnl || 0) > 0);
      const winRate = closedTrades.length > 0 
        ? (winningTrades.length / closedTrades.length) * 100 
        : 0;
      
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

      {/* Recent Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Trades</CardTitle>
          </CardHeader>
          <CardContent>
            {recentTrades.length === 0 ? (
              <p className="text-muted-foreground">No trades yet</p>
            ) : (
              <div className="space-y-2">
                {recentTrades.map((trade) => (
                  <div key={trade.id} className="flex items-center justify-between p-2 bg-secondary rounded">
                    <div>
                      <div className="font-medium">{trade.pair}</div>
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
            {recentSignals.length === 0 ? (
              <p className="text-muted-foreground">No signals yet</p>
            ) : (
              <div className="space-y-2">
                {recentSignals.map((signal) => (
                  <div key={signal.id} className="flex items-center justify-between p-2 bg-secondary rounded">
                    <div>
                      <div className="font-medium">{signal.pair}</div>
                      <div className="text-sm text-muted-foreground">{signal.net_edge_bps} bps</div>
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
