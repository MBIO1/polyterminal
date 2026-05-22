import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
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
import { History, Download } from 'lucide-react';

export default function Trades() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadTrades();
    
    // Subscribe to real-time trade updates
    const unsubscribe = base44.entities.ArbTrade.subscribe((event) => {
      console.log('Trade update:', event.type, event.data);
      loadTrades(); // Reload all trades on any change
    });
    
    return () => unsubscribe();
  }, []);

  const loadTrades = async () => {
    try {
      setLoading(true);
      const data = await base44.entities.ArbTrade.list('-created_date', 100);
      setTrades(data);
    } catch (error) {
      console.error('Load trades error:', error);
    } finally {
      setLoading(false);
    }
  };

  const downloadCSV = () => {
    const headers = ['Trade ID','Asset','Strategy','Status','Entry Spread (bps)','Exit Spread (bps)','Net P&L','Mode','Entry Date'];
    const rows = trades.map(t => [
      t.trade_id || t.id,
      t.asset || '',
      t.strategy || '',
      t.status || '',
      t.entry_spread_bps?.toFixed(2) ?? '',
      t.exit_spread_bps?.toFixed(2) ?? '',
      (t.net_pnl || 0).toFixed(2),
      t.mode || '',
      t.created_date ? new Date(t.created_date).toLocaleDateString() : '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trade-history-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
        <div className="flex gap-2">
          <Button onClick={downloadCSV} variant="outline" disabled={trades.length === 0}>
            <Download className="w-4 h-4 mr-2" />Export CSV
          </Button>
          <Button onClick={loadTrades} variant="outline">Refresh</Button>
        </div>
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
                  <TableHead>Asset</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Entry Spread (bps)</TableHead>
                  <TableHead>Exit Spread (bps)</TableHead>
                  <TableHead>P&L</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTrades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell className="font-medium">{trade.asset}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{trade.strategy}</TableCell>
                    <TableCell>
                      <Badge variant={trade.status === 'Open' ? 'default' : 'secondary'}>
                        {trade.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono">{trade.entry_spread_bps?.toFixed(2) || '-'}</TableCell>
                    <TableCell className="font-mono">{trade.exit_spread_bps?.toFixed(2) || '-'}</TableCell>
                    <TableCell className={`font-mono ${(trade.net_pnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {(trade.net_pnl || 0) >= 0 ? '+' : ''}${(trade.net_pnl || 0).toFixed(2)}
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