import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  Zap, 
  Clock,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight
} from 'lucide-react';

const SIGNAL_ICONS = {
  detected: Zap,
  alerted: Activity,
  executed: TrendingUp,
  expired: Clock,
  rejected: XCircle
};

const SIGNAL_COLORS = {
  detected: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  alerted: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  executed: 'bg-green-500/20 text-green-400 border-green-500/30',
  expired: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30'
};

export default function LiveSignalsFeed() {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    executed: 0,
    rejected: 0,
    avgEdge: 0
  });

  const loadSignals = async () => {
    try {
      const recentSignals = await base44.entities.ArbSignal.list('-received_time', 50);
      
      // Filter to last 30 minutes
      const now = Date.now();
      const filtered = recentSignals.filter(s => {
        const age = now - new Date(s.received_time || s.created_date).getTime();
        return age < 30 * 60 * 1000;
      });

      setSignals(filtered.slice(0, 20));

      // Calculate stats
      const executed = filtered.filter(s => s.status === 'executed');
      const rejected = filtered.filter(s => s.status === 'rejected');
      const avgEdge = executed.length > 0 
        ? executed.reduce((sum, s) => sum + (s.net_edge_bps || 0), 0) / executed.length 
        : 0;

      setStats({
        total: filtered.length,
        executed: executed.length,
        rejected: rejected.length,
        avgEdge: parseFloat(avgEdge.toFixed(2))
      });
    } catch (error) {
      console.error('Failed to load signals:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSignals();

    // Subscribe to real-time updates
    const unsubscribe = base44.entities.ArbSignal.subscribe((event) => {
      console.log('Signal update:', event.type);
      loadSignals();
    });

    // Refresh every 10 seconds
    const interval = setInterval(loadSignals, 10000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const formatAge = (timestamp) => {
    const age = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (age < 60) return `${age}s`;
    if (age < 3600) return `${Math.floor(age / 60)}m`;
    return `${Math.floor(age / 3600)}h`;
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Live Signals Feed
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              Last 30 min
            </Badge>
          </div>
          <Button 
            onClick={loadSignals} 
            variant="ghost" 
            size="sm"
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2 mt-3">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-bold font-mono">{stats.total}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Executed</p>
            <p className="text-lg font-bold text-green-400">{stats.executed}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Rejected</p>
            <p className="text-lg font-bold text-red-400">{stats.rejected}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Avg Edge</p>
            <p className="text-lg font-bold text-primary">{stats.avgEdge} bps</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {loading && signals.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Loading signals...
          </div>
        ) : signals.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
            <Activity className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No signals in last 30 minutes</p>
            <p className="text-xs mt-1">Market is quiet or filters are tight</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
            {signals.map((signal) => {
              const Icon = SIGNAL_ICONS[signal.status] || Zap;
              const colorClass = SIGNAL_COLORS[signal.status] || SIGNAL_COLORS.detected;
              const age = formatAge(signal.received_time || signal.created_date);

              return (
                <div 
                  key={signal.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 transition-colors"
                >
                  {/* Status icon */}
                  <div className={`p-1.5 rounded-md ${colorClass}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>

                  {/* Asset & pair */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold font-mono">{signal.asset || 'N/A'}</span>
                      <span className="text-xs text-muted-foreground">{signal.pair}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <span>{signal.buy_exchange?.split('-')[0] || 'N/A'} → {signal.sell_exchange?.split('-')[0] || 'N/A'}</span>
                    </div>
                  </div>

                  {/* Edge & liquidity */}
                  <div className="text-right">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-sm font-bold font-mono ${signal.net_edge_bps >= 3 ? 'text-green-400' : 'text-foreground'}`}>
                        {signal.net_edge_bps?.toFixed(2)} bps
                      </span>
                      {signal.net_edge_bps >= 3 && (
                        <Badge className="text-[10px] bg-green-500/20 text-green-400 border-green-500/30 border h-4">
                          QUALIFIED
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      ${signal.fillable_size_usd?.toFixed(0) || signal.buy_depth_usd?.toFixed(0) || 'N/A'} liq
                    </div>
                  </div>

                  {/* Age */}
                  <div className="text-right min-w-[60px]">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span className="font-mono">{age}</span>
                    </div>
                    <Badge variant="outline" className={`text-[10px] h-4 mt-1 ${colorClass}`}>
                      {signal.status.toUpperCase()}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}