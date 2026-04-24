import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  RefreshCw, Play, TrendingUp, Scale, Activity,
  DollarSign, AlertTriangle, CheckCircle2, XCircle, BarChart2
} from 'lucide-react';

function StatusBadge({ status }) {
  const map = {
    healthy: 'bg-green-500/20 text-green-400 border-green-500/30',
    warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    critical: 'bg-red-500/20 text-red-400 border-red-500/30',
    unknown:  'bg-gray-500/20 text-gray-400 border-gray-500/30',
    insufficient_data: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  };
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${map[status] || map.unknown}`}>
      {status}
    </span>
  );
}

function MetricRow({ label, value, sub, tone }) {
  const toneClass = tone === 'positive' ? 'text-green-400' : tone === 'negative' ? 'text-red-400' : tone === 'warn' ? 'text-yellow-400' : 'text-foreground';
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground font-mono">{label}</span>
      <div className="text-right">
        <span className={`text-sm font-mono font-semibold ${toneClass}`}>{value}</span>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

export default function PortfolioManager() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['portfolio-manager-status'],
    queryFn: async () => {
      const res = await base44.functions.invoke('portfolioManager', { execute: false });
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke('portfolioManager', { execute: true });
      return res.data;
    },
    onSuccess: (data) => {
      setResult(data);
      refetch();
    },
    onError: (e) => setError(e.message),
  });

  const data = result || status;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-primary" /> Portfolio Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            Correlation · Rebalancing · Profit Compounding · Position Sizing
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => executeMutation.mutate()} disabled={executeMutation.isPending}>
            <Play className="w-4 h-4 mr-2" />
            {executeMutation.isPending ? 'Running...' : 'Execute Now'}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert className="border-green-500/50 bg-green-500/10">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <AlertTitle>Execution Complete</AlertTitle>
          <AlertDescription>
            {result.actions?.length || 0} action(s) taken at {new Date(result.timestamp).toLocaleTimeString()}
          </AlertDescription>
        </Alert>
      )}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

          {/* Correlation */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" /> Correlation Monitor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Overall</span>
                <StatusBadge status={data.correlation?.status || 'unknown'} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Can Trade</span>
                {data.correlation?.canTrade
                  ? <CheckCircle2 className="w-4 h-4 text-green-400" />
                  : <XCircle className="w-4 h-4 text-red-400" />}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Pairs Monitored</span>
                <span className="text-sm font-mono">{data.correlation?.pairs ?? '—'}</span>
              </div>
              {data.correlation?.critical > 0 && (
                <div className="flex items-center gap-2 p-2 bg-red-500/10 rounded border border-red-500/30">
                  <AlertTriangle className="w-3 h-3 text-red-400" />
                  <span className="text-xs text-red-400">{data.correlation.critical} critical pair(s)</span>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">Halt threshold: 80% correlation</p>
            </CardContent>
          </Card>

          {/* Rebalancer */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Scale className="w-4 h-4 text-primary" /> Auto-Rebalancer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Rebalance Needed</span>
                <Badge variant={data.rebalance?.needed ? 'destructive' : 'secondary'}>
                  {data.rebalance?.needed ? 'Yes' : 'No'}
                </Badge>
              </div>
              <MetricRow
                label="Margin Utilization"
                value={data.rebalance?.marginUtil != null ? `${(data.rebalance.marginUtil * 100).toFixed(1)}%` : '—'}
              />
              <MetricRow
                label="Hedge Ratio"
                value={data.rebalance?.hedgeRatio != null ? `${(data.rebalance.hedgeRatio * 100).toFixed(1)}%` : '—'}
                tone={data.rebalance?.hedgeRatio > 0.95 ? 'positive' : 'negative'}
              />
              <MetricRow
                label="Net Delta"
                value={data.rebalance?.netDelta != null ? `$${Number(data.rebalance.netDelta).toFixed(0)}` : '—'}
                tone={Math.abs(data.rebalance?.netDelta || 0) < 50 ? 'positive' : 'warn'}
              />
              <p className="text-[10px] text-muted-foreground">Last: {data.rebalance?.lastRebalance === 'never' ? 'Never' : new Date(data.rebalance?.lastRebalance).toLocaleString()}</p>
            </CardContent>
          </Card>

          {/* Compounding */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" /> Profit Compounding
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Should Compound</span>
                <Badge variant={data.compounding?.shouldCompound ? 'default' : 'secondary'}>
                  {data.compounding?.shouldCompound ? 'Yes' : 'No'}
                </Badge>
              </div>
              <MetricRow label="Yesterday P&L" value={`$${Number(data.compounding?.profit || 0).toFixed(2)}`} tone={data.compounding?.profit > 0 ? 'positive' : 'negative'} />
              <MetricRow label="Reason" value={data.compounding?.reason || '—'} />
              <p className="text-[10px] text-muted-foreground">70% compound · 30% reserve</p>
            </CardContent>
          </Card>

          {/* Portfolio Summary */}
          <Card className="md:col-span-2 lg:col-span-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-primary" /> Portfolio Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Current Capital', value: `$${Number(data.portfolio?.currentCapital || 0).toLocaleString()}` },
                  { label: 'Compounded Profits', value: `$${Number(data.portfolio?.compoundedProfits || 0).toFixed(2)}` },
                  { label: 'Reserved Profits', value: `$${Number(data.portfolio?.reservedProfits || 0).toFixed(2)}` },
                  { label: 'Compound Count', value: data.portfolio?.compoundCount ?? 0 },
                ].map(({ label, value }) => (
                  <div key={label} className="p-3 bg-secondary/50 rounded">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-sm font-mono font-semibold mt-1">{value}</p>
                  </div>
                ))}
              </div>
              {data.portfolio?.lastCompound && (
                <p className="text-[10px] text-muted-foreground mt-3">Last compound: {new Date(data.portfolio.lastCompound).toLocaleString()}</p>
              )}
            </CardContent>
          </Card>

          {/* Actions Log */}
          {data.actions?.length > 0 && (
            <Card className="md:col-span-2 lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Actions Taken</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.actions.map((action, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-secondary/50 rounded">
                    <Badge variant={action.type === 'trading_halted' ? 'destructive' : 'default'}>
                      {action.type}
                    </Badge>
                    <pre className="text-[10px] font-mono text-muted-foreground overflow-x-auto">
                      {JSON.stringify(action, null, 2)}
                    </pre>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}