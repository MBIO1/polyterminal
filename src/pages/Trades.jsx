import React, { useState, useEffect } from 'react';
import { tradesApi } from '@/api/proxyClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { History, TrendingUp, TrendingDown } from 'lucide-react';

export default function Trades() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadTrades();
  }, []);

  const loadTrades = async () => {
    try {
      setLoading(true);
      const res = await tradesApi.getAll();
      setTrades(res.trades || []);
    } catch (error) {
      console.error('Load trades error:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredTrades = trades.filter(trade => {
    if (filter === 'all') return true;
    return trade.status?.toLowerCase() === filter;
  });

  const stats = {
    total: trades.length,
    open: trades.filter(t => t.status === 'Open').length,
    closed: trades.filter(t => t.status === 'Closed').length,
    totalPnl: trades.reduce((sum, t) => sum + (t.net_pnl || 0), 0),
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <History className="w-8 h-8" />
            Trades
          </h1>
          <p className="text-muted-foreground mt-1">View all your arbitrage trades</p>
        </div>
        <Button onClick={loadTrades} variant="outline">Refresh</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-sm text-muted-foreground">Total Trades</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-blue-600">{stats.open}</div>
            <p className="text-sm text-muted-foreground">Open</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">{stats.closed}</div>
            <p className="text-sm text-muted-foreground">Closed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className={`text-2xl font-bold ${stats.totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ${stats.totalPnl.toFixed(2)}
            </div>
            <p className="text-sm text-muted-foreground">Total P&L</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {['all', 'open', 'closed'].map((f) => (
          <Button
            key={f}
            variant={filter === f ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      {/* Trades Table */}
      <Card>
        <CardHeader>
          <CardTitle>Trade History</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p>Loading trades...</p>
          ) : filteredTrades.length === 0 ? (
            <p className="text-muted-foreground">No trades found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pair</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Entry Price</TableHead>
                  <TableHead>Exit Price</TableHead>
                  <TableHead>P&L</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTrades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell className="font-medium">{trade.pair}</TableCell>
                    <TableCell>
                      <Badge variant={trade.status === 'Open' ? 'default' : 'secondary'}>
                        {trade.status}
                      </Badge>
                    </TableCell>
                    <TableCell>${trade.notional_usd?.toFixed(2) || '0.00'}</TableCell>
                    <TableCell>{trade.entry_price?.toFixed(2) || '-'}</TableCell>
                    <TableCell>{trade.exit_price?.toFixed(2) || '-'}</TableCell>
                    <TableCell className={`font-mono ${(trade.net_pnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {(trade.net_pnl || 0) >= 0 ? '+' : ''}${trade.net_pnl?.toFixed(2) || '0.00'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {trade.created_date ? new Date(trade.created_date).toLocaleDateString() : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
