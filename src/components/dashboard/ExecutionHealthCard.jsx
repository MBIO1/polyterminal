import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Zap, CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const REJECTION_CLASSES = {
  HEALTHY_FILTER: [
    'hard_stale_5min', 'capital_too_small', 'net_edge_bps',
    'no_bybit_leg', 'same_venue', 'ttl_exceeded',
  ],
  EXECUTION_FAILURE: [
    'droplet_http_500', 'droplet_http_400', 'exec_error', 'droplet_exec_failed',
  ],
  EXCHANGE_RULE: [
    'qty_below_min', 'min_notional', 'step_size', 'Insufficient balance',
  ],
};

function classifyRejection(reason) {
  if (!reason) return 'UNKNOWN';
  const lower = reason.toLowerCase();
  for (const [cls, patterns] of Object.entries(REJECTION_CLASSES)) {
    if (patterns.some(p => lower.includes(p.toLowerCase()))) return cls;
  }
  return 'UNKNOWN';
}

export default function ExecutionHealthCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const signals = await base44.entities.ArbSignal.list('-received_time', 500);
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const recent = signals.filter(s => {
          const t = new Date(s.received_time || s.created_date).getTime();
          return t && t >= cutoff;
        });

        const executed = recent.filter(s => s.status === 'executed');
        const rejected = recent.filter(s => s.status === 'rejected' || s.status === 'expired');

        let healthyFilter = 0, execFailure = 0, exchangeRule = 0, unknown = 0;
        const execFailureDetails = [];

        for (const s of rejected) {
          const cls = classifyRejection(s.rejection_reason);
          if (cls === 'HEALTHY_FILTER') healthyFilter++;
          else if (cls === 'EXECUTION_FAILURE') {
            execFailure++;
            execFailureDetails.push({
              pair: s.pair,
              reason: s.rejection_reason,
              time: s.received_time || s.created_date,
            });
          }
          else if (cls === 'EXCHANGE_RULE') exchangeRule++;
          else unknown++;
        }

        // Execution success rate = executed / (executed + exec_failure + exchange_rule)
        const attemptedExec = executed.length + execFailure + exchangeRule;
        const execSuccessRate = attemptedExec > 0
          ? ((executed.length / attemptedExec) * 100).toFixed(1)
          : '100.0';

        // Overall health verdict
        let health = 'healthy';
        if (execFailure > 0 || exchangeRule > 2) health = 'degraded';
        if (execFailure > 3) health = 'critical';

        if (mounted) setData({
          total: recent.length,
          executed: executed.length,
          healthyFilter,
          execFailure,
          exchangeRule,
          unknown,
          execSuccessRate,
          health,
          execFailureDetails: execFailureDetails.slice(0, 5),
          wins: executed.filter(s => s.win === true).length,
          losses: executed.filter(s => s.win === false).length,
        });
      } catch (e) {
        console.error('ExecutionHealthCard error:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Execution Health</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground text-sm">Loading...</p></CardContent>
      </Card>
    );
  }

  if (!data || data.total === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Execution Health</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground text-sm">No signals in 24h.</p></CardContent>
      </Card>
    );
  }

  const healthColor = {
    healthy: 'text-green-400 border-green-500/30 bg-green-500/10',
    degraded: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
    critical: 'text-red-400 border-red-500/30 bg-red-500/10',
  }[data.health];

  const HealthIcon = data.health === 'healthy' ? CheckCircle2 : data.health === 'degraded' ? AlertTriangle : XCircle;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-muted-foreground" />
            Execution Health — Last 24h
          </CardTitle>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold ${healthColor}`}>
            <HealthIcon className="w-3.5 h-3.5" />
            {data.health.charAt(0).toUpperCase() + data.health.slice(1)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Key metrics row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricTile label="Exec Success" value={`${data.execSuccessRate}%`} sub={`${data.executed} executed`} color="text-green-400" />
          <MetricTile label="Healthy Filters" value={data.healthyFilter} sub="Expected rejections" color="text-blue-400" />
          <MetricTile label="Exec Failures" value={data.execFailure} sub="Droplet/network errors" color={data.execFailure > 0 ? 'text-red-400' : 'text-muted-foreground'} />
          <MetricTile label="Exchange Rules" value={data.exchangeRule} sub="Min size / balance" color={data.exchangeRule > 0 ? 'text-yellow-400' : 'text-muted-foreground'} />
        </div>

        {/* Win/Loss of executed */}
        {data.executed > 0 && (
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">Executed outcomes:</span>
            <span className="text-green-400 font-mono">{data.wins}W</span>
            <span className="text-red-400 font-mono">{data.losses}L</span>
            <span className="text-muted-foreground font-mono">
              {data.executed - data.wins - data.losses} pending
            </span>
          </div>
        )}

        {/* Execution failure details */}
        {data.execFailureDetails.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">
              Recent Exec Failures
            </div>
            <div className="space-y-1.5">
              {data.execFailureDetails.map((d, i) => (
                <div key={i} className="flex items-start gap-2 text-xs bg-red-500/5 border border-red-500/10 rounded px-2.5 py-1.5">
                  <Clock className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <span className="font-mono text-red-300">{d.pair}</span>
                    <span className="text-muted-foreground ml-2 truncate block" title={d.reason}>
                      {d.reason?.slice(0, 80)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricTile({ label, value, sub, color }) {
  return (
    <div className="bg-secondary/50 rounded-lg p-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}