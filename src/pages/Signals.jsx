import React, { useState, useEffect } from 'react';
import { signalsApi } from '@/api/proxyClient';
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
import { Signal, Zap, AlertCircle } from 'lucide-react';

export default function Signals() {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    executed: 0,
    rejected: 0,
    avgEdge: 0,
  });

  useEffect(() => {
    loadSignals();
  }, []);

  const loadSignals = async () => {
    try {
      setLoading(true);
      const res = await signalsApi.getStats();
      const signalList = res.signals || [];
      setSignals(signalList);
      
      // Calculate stats
      const executed = signalList.filter(s => s.status === 'executed').length;
      const rejected = signalList.filter(s => s.status === 'rejected').length;
      const avgEdge = signalList.length > 0 
        ? signalList.reduce((sum, s) => sum + (s.net_edge_bps || 0), 0) / signalList.length 
        : 0;
      
      setStats({
        total: signalList.length,
        executed,
        rejected,
        avgEdge: avgEdge.toFixed(2),
      });
    } catch (error) {
      console.error('Load signals error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Signal className="w-8 h-8" />
            Signals
          </h1>
          <p className="text-muted-foreground mt-1">Arbitrage signals detected by the bot</p>
        </div>
        <Button onClick={loadSignals} variant="outline">Refresh</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-sm text-muted-foreground">Total Signals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">{stats.executed}</div>
            <p className="text-sm text-muted-foreground">Executed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-yellow-600">{stats.rejected}</div>
            <p className="text-sm text-muted-foreground">Rejected</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-blue-600">{stats.avgEdge} bps</div>
            <p className="text-sm text-muted-foreground">Avg Edge</p>
          </CardContent>
        </Card>
      </div>

      {/* Signals Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Signals</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p>Loading signals...</p>
          ) : signals.length === 0 ? (
            <p className="text-muted-foreground">No signals found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Pair</TableHead>
                  <TableHead>Edge (bps)</TableHead>
                  <TableHead>Buy</TableHead>
                  <TableHead>Sell</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.slice(0, 50).map((signal) => (
                  <TableRow key={signal.id}>
                    <TableCell className="text-muted-foreground">
                      {signal.received_time 
                        ? new Date(signal.received_time).toLocaleTimeString() 
                        : '-'}
                    </TableCell>
                    <TableCell className="font-medium">{signal.pair}</TableCell>
                    <TableCell className="font-mono">{signal.net_edge_bps?.toFixed(2) || '0.00'}</TableCell>
                    <TableCell>{signal.buy_exchange}</TableCell>
                    <TableCell>{signal.sell_exchange}</TableCell>
                    <TableCell>
                      <Badge 
                        variant={
                          signal.status === 'executed' ? 'default' :
                          signal.status === 'rejected' ? 'destructive' :
                          'secondary'
                        }
                      >
                        {signal.status}
                      </Badge>
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
