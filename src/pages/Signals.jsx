import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from '@/components/ui/table';
import { Signal, Zap, ShieldAlert } from 'lucide-react';
import SignalBlockerPanel from '@/components/arb/SignalBlockerPanel';

const TABS = [
  { id: 'feed',     label: 'Signal Feed' },
  { id: 'blockers', label: '⚡ What\'s Blocking Signals' },
];

export default function Signals() {
  const [tab, setTab] = useState('feed');
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, executed: 0, rejected: 0, avgEdge: 0 });

  useEffect(() => { loadSignals(); }, []);

  const loadSignals = async () => {
    try {
      setLoading(true);
      const signalList = await base44.entities.ArbSignal.list('-received_time', 50);
      setSignals(signalList);
      const executed = signalList.filter(s => s.status === 'executed').length;
      const rejected = signalList.filter(s => s.status === 'rejected').length;
      const avgEdge = signalList.length > 0
        ? signalList.reduce((sum, s) => sum + (s.net_edge_bps || 0), 0) / signalList.length
        : 0;
      setStats({ total: signalList.length, executed, rejected, avgEdge: avgEdge.toFixed(2) });
    } catch (error) {
      console.error('Load signals error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Signal className="w-8 h-8" />
            Signals
          </h1>
          <p className="text-muted-foreground mt-1">Arbitrage signals detected by the bot</p>
        </div>
        {tab === 'feed' && (
          <Button onClick={loadSignals} variant="outline">Refresh</Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.id === 'blockers' && <ShieldAlert className="w-3.5 h-3.5 inline mr-1.5 text-yellow-400" />}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'feed' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card><CardContent className="pt-6">
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-sm text-muted-foreground">Total Signals</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-400">{stats.executed}</div>
              <p className="text-sm text-muted-foreground">Executed</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-2xl font-bold text-yellow-400">{stats.rejected}</div>
              <p className="text-sm text-muted-foreground">Rejected</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <div className="text-2xl font-bold text-primary">{stats.avgEdge} bps</div>
              <p className="text-sm text-muted-foreground">Avg Edge</p>
            </CardContent></Card>
          </div>

          {/* Signals Table */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Signals</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-muted-foreground">Loading signals...</p>
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
                      <TableHead>Fillable</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Rejection Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signals.map((signal) => (
                      <TableRow key={signal.id}>
                        <TableCell className="text-muted-foreground text-xs">
                          {signal.received_time ? new Date(signal.received_time).toLocaleTimeString() : '-'}
                        </TableCell>
                        <TableCell className="font-medium font-mono">{signal.pair}</TableCell>
                        <TableCell className={`font-mono font-semibold ${signal.net_edge_bps >= 10 ? 'text-green-400' : signal.net_edge_bps >= 3 ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                          {signal.net_edge_bps?.toFixed(2) || '0.00'}
                        </TableCell>
                        <TableCell className="text-xs">{signal.buy_exchange}</TableCell>
                        <TableCell className="text-xs">{signal.sell_exchange}</TableCell>
                        <TableCell className="text-xs font-mono">
                          {signal.fillable_size_usd ? `$${Math.round(signal.fillable_size_usd).toLocaleString()}` : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            signal.status === 'executed' ? 'default' :
                            signal.status === 'rejected' ? 'destructive' :
                            signal.status === 'expired' ? 'outline' :
                            'secondary'
                          }>
                            {signal.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">
                          {signal.rejection_reason || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {tab === 'blockers' && <SignalBlockerPanel />}
    </div>
  );
}