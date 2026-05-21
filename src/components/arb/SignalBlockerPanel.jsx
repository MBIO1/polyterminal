import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  AlertTriangle, CheckCircle2, XCircle, Clock, Zap,
  TrendingDown, RefreshCw, ChevronRight, Info
} from 'lucide-react';

const BLOCKER_COLORS = {
  executed:               '#22c55e',
  expired_ttl:            '#f59e0b',
  expired_stale:          '#ef4444',
  rejected_low_confidence:'#a78bfa',
  rejected_low_edge:      '#0ea5e9',
  rejected_low_fillable:  '#f97316',
  rejected_exec_error:    '#ec4899',
};

const BLOCKER_LABELS = {
  executed:               'Executed ✓',
  expired_ttl:            'Expired (TTL)',
  expired_stale:          'Expired (Stale)',
  rejected_low_confidence:'Low Confidence',
  rejected_low_edge:      'Low Edge',
  rejected_low_fillable:  'Low Liquidity',
  rejected_exec_error:    'Exec Error',
};

function FunnelBar({ label, count, total, color, pct }) {
  const width = total > 0 ? Math.max((count / total) * 100, count > 0 ? 3 : 0) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-mono">
        <span className="text-muted-foreground">{label}</span>
        <span style={{ color }}>{count} ({pct}%)</span>
      </div>
      <div className="h-2 bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function GapCard({ gap, index }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
          <span className="text-sm font-medium">{gap.issue}</span>
        </div>
        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2 text-xs border-t border-border bg-secondary/20">
          <div className="grid grid-cols-2 gap-3 pt-3">
            <div>
              <p className="text-muted-foreground mb-1">Current</p>
              <p className="font-mono text-red-400">{gap.current}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Industry Standard</p>
              <p className="font-mono text-green-400">{gap.industry}</p>
            </div>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">Impact</p>
            <p className="text-foreground">{gap.impact}</p>
          </div>
          <div className="bg-primary/10 border border-primary/20 rounded px-3 py-2">
            <p className="text-primary font-medium mb-0.5">Fix</p>
            <p className="text-foreground">{gap.fix}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SignalBlockerPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('diagnoseRejections', {});
      setData(res.data);
    } catch (e) {
      setError(e.message || 'Failed to load rejection analysis');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-primary mb-2" />
          <p className="text-sm text-muted-foreground">Analyzing signal blockers...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <XCircle className="w-5 h-5 text-destructive mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={load} variant="outline" size="sm" className="mt-3">Retry</Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { summary, metrics, critical_gaps } = data;
  const total = summary.total_signals || 0;

  // Build funnel data
  const funnelItems = [
    { key: 'executed',                count: summary.executed },
    { key: 'expired_ttl',             count: summary.expired_ttl },
    { key: 'expired_stale',           count: summary.expired_stale },
    { key: 'rejected_low_confidence', count: summary.rejected_low_confidence },
    { key: 'rejected_low_edge',       count: summary.rejected_low_edge },
    { key: 'rejected_low_fillable',   count: summary.rejected_low_fillable },
    { key: 'rejected_exec_error',     count: summary.rejected_exec_error },
  ].filter(i => i.count > 0);

  const pieData = funnelItems.map(i => ({
    name: BLOCKER_LABELS[i.key],
    value: i.count,
    color: BLOCKER_COLORS[i.key],
  }));

  const blockerCount = funnelItems.filter(i => i.key !== 'executed').reduce((a, i) => a + i.count, 0);
  const execRate = summary.execution_rate_pct ?? 0;
  const execRateGood = execRate >= 10;

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground font-mono">TOTAL SIGNALS</span>
            </div>
            <p className="text-2xl font-bold font-mono">{total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <span className="text-xs text-muted-foreground font-mono">EXEC RATE</span>
            </div>
            <p className={`text-2xl font-bold font-mono ${execRateGood ? 'text-green-400' : 'text-yellow-400'}`}>
              {execRate.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">target ≥10%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-xs text-muted-foreground font-mono">BLOCKED</span>
            </div>
            <p className="text-2xl font-bold font-mono text-red-400">{blockerCount}</p>
            <p className="text-xs text-muted-foreground">{total > 0 ? ((blockerCount / total)*100).toFixed(0) : 0}% of signals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-mono">AVG SIGNAL AGE</span>
            </div>
            <p className={`text-2xl font-bold font-mono ${metrics.avg_signal_age_ms > 5000 ? 'text-red-400' : 'text-foreground'}`}>
              {metrics.avg_signal_age_ms > 1000
                ? `${(metrics.avg_signal_age_ms / 1000).toFixed(1)}s`
                : `${metrics.avg_signal_age_ms}ms`}
            </p>
            <p className="text-xs text-muted-foreground">at execution</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Rejection funnel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Rejection Funnel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {funnelItems.map(item => (
              <FunnelBar
                key={item.key}
                label={BLOCKER_LABELS[item.key]}
                count={item.count}
                total={total}
                color={BLOCKER_COLORS[item.key]}
                pct={total > 0 ? ((item.count / total) * 100).toFixed(1) : '0.0'}
              />
            ))}
            {funnelItems.length === 0 && (
              <p className="text-sm text-muted-foreground">No signal data yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Pie chart */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Blocker Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v, n) => [`${v} signals`, n]}
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-1 mt-2">
                  {pieData.map((d, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="text-muted-foreground truncate">{d.name}</span>
                      <span className="font-mono ml-auto">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No data</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Critical gaps */}
      {critical_gaps?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-yellow-400" />
                Critical Gaps ({critical_gaps.length})
              </CardTitle>
              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 border text-xs">
                Action Required
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {critical_gaps.map((gap, i) => (
              <GapCard key={i} gap={gap} index={i} />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={load} variant="outline" size="sm" className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" /> Re-analyze
        </Button>
      </div>
    </div>
  );
}