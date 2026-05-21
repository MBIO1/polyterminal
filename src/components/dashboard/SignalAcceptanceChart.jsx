import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, AlertTriangle, Filter } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { base44 } from '@/api/base44Client';

const ACCEPTED_STATUSES = new Set(['detected', 'alerted', 'executed']);
const REJECTED_STATUSES = new Set(['rejected', 'expired']);

// Rejection classifier — categorizes rejection_reason strings
const REJECTION_CLASSES = {
  HEALTHY_FILTER: [
    'hard_stale_5min',
    'capital_too_small',
    'net_edge_bps',
    'no_bybit_leg',
    'same_venue',
    'ttl_exceeded',
  ],
  EXECUTION_FAILURE: [
    'droplet_http_500',
    'droplet_http_400',
    'exec_error',
    'droplet_exec_failed',
  ],
  EXCHANGE_RULE: [
    'qty_below_min',
    'min_notional',
    'step_size',
    'Insufficient balance',
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

const CLASS_META = {
  HEALTHY_FILTER:    { label: 'Filters', color: 'text-blue-400',   bg: 'bg-blue-500/60' },
  EXECUTION_FAILURE: { label: 'Execution', color: 'text-red-400',    bg: 'bg-red-500/60' },
  EXCHANGE_RULE:     { label: 'Rules',   color: 'text-yellow-400', bg: 'bg-yellow-500/60' },
  UNKNOWN:           { label: 'Other',            color: 'text-gray-400',   bg: 'bg-gray-500/60' },
};

function formatReasonLabel(reason) {
  const text = String(reason || '').toLowerCase();
  if (text.includes('capital_too_small') || text.includes('available_capital')) return 'Capital Flow';
  if (text.includes('hard_stale') || text.includes('stale_signal') || text.includes('ttl_exceeded')) return 'Stale Signal';
  if (text.includes('droplet_http_500') || text.includes('exec_error')) return 'Execution';
  if (text.includes('qty_below_min') || text.includes('min_notional') || text.includes('step_size')) return 'Order Size';
  if (text.includes('insufficient_liquidity')) return 'Liquidity';
  if (text.includes('net_edge')) return 'Low Edge';
  if (text.includes('same_venue')) return 'Same Venue';
  if (text.includes('no_bybit_leg')) return 'Bybit Route';
  return 'Other';
}

function buildHourlyBuckets(signals) {
  const now = Date.now();
  const startMs = now - 24 * 60 * 60 * 1000;

  // 24 hourly buckets
  const buckets = [];
  for (let i = 23; i >= 0; i--) {
    const ts = now - i * 60 * 60 * 1000;
    const d = new Date(ts);
    buckets.push({
      hour: d.getHours().toString().padStart(2, '0') + ':00',
      bucketStart: Math.floor(ts / (60 * 60 * 1000)) * (60 * 60 * 1000),
      accepted: 0,
      rejected: 0,
    });
  }
  const byBucket = new Map(buckets.map(b => [b.bucketStart, b]));

  for (const s of signals) {
    const t = new Date(s.received_time || s.signal_time || s.created_date).getTime();
    if (!t || t < startMs) continue;
    const bucketStart = Math.floor(t / (60 * 60 * 1000)) * (60 * 60 * 1000);
    const b = byBucket.get(bucketStart);
    if (!b) continue;
    if (REJECTED_STATUSES.has(s.status)) b.rejected += 1;
    else if (ACCEPTED_STATUSES.has(s.status)) b.accepted += 1;
  }
  return buckets;
}

function buildRejectionBreakdown(signals) {
  const reasons = new Map();
  for (const s of signals) {
    if (!REJECTED_STATUSES.has(s.status)) continue;
    const r = (s.rejection_reason || 'unspecified').trim() || 'unspecified';
    reasons.set(r, (reasons.get(r) || 0) + 1);
  }
  return [...reasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count, cls: classifyRejection(reason) }));
}

function buildClassBreakdown(signals) {
  const classes = { HEALTHY_FILTER: 0, EXECUTION_FAILURE: 0, EXCHANGE_RULE: 0, UNKNOWN: 0 };
  for (const s of signals) {
    if (!REJECTED_STATUSES.has(s.status)) continue;
    const cls = classifyRejection(s.rejection_reason);
    classes[cls] = (classes[cls] || 0) + 1;
  }
  return Object.entries(classes)
    .filter(([_, count]) => count > 0)
    .map(([cls, count]) => ({ cls, count, ...CLASS_META[cls] }));
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const accepted = payload.find(p => p.dataKey === 'accepted')?.value || 0;
  const rejected = payload.find(p => p.dataKey === 'rejected')?.value || 0;
  const total = accepted + rejected;
  const acceptPct = total > 0 ? ((accepted / total) * 100).toFixed(0) : '0';
  return (
    <div className="bg-popover border border-border rounded-md p-3 shadow-lg text-xs">
      <div className="font-mono font-semibold mb-1">{label}</div>
      <div className="text-green-400">Accepted: {accepted}</div>
      <div className="text-red-400">Rejected: {rejected}</div>
      {total > 0 && (
        <div className="text-muted-foreground mt-1 pt-1 border-t border-border">
          Acceptance: {acceptPct}%
        </div>
      )}
    </div>
  );
}

export default function SignalAcceptanceChart() {
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        // pull last 24h worth — use a generous cap
        const data = await base44.entities.ArbSignal.list('-received_time', 1000);
        if (mounted) setSignals(data || []);
      } catch (e) {
        console.error('SignalAcceptanceChart load error:', e);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const buckets = buildHourlyBuckets(signals);
  const recentSignals = signals.filter(s => {
    const t = new Date(s.received_time || s.signal_time || s.created_date).getTime();
    return t && t >= Date.now() - 24 * 60 * 60 * 1000;
  });
  const rejectionBreakdown = buildRejectionBreakdown(recentSignals);
  const classBreakdown = buildClassBreakdown(recentSignals);

  const totalAccepted = buckets.reduce((sum, b) => sum + b.accepted, 0);
  const totalRejected = buckets.reduce((sum, b) => sum + b.rejected, 0);
  const total = totalAccepted + totalRejected;
  const acceptancePct = total > 0 ? ((totalAccepted / total) * 100).toFixed(1) : '0.0';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
              Signal Acceptance — Last 24h
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Hourly accepted vs rejected signals + top rejection reasons
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <span className="font-mono text-green-400">{totalAccepted}</span>
              <span className="text-muted-foreground">accepted</span>
            </div>
            <div className="flex items-center gap-1.5">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="font-mono text-red-400">{totalRejected}</span>
              <span className="text-muted-foreground">rejected</span>
            </div>
            <Badge variant="outline" className="font-mono">
              {acceptancePct}% accept
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading...</p>
        ) : total === 0 ? (
          <p className="text-muted-foreground text-sm">No signals in the last 24 hours.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart */}
            <div className="lg:col-span-2 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buckets} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    interval={2}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.3)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="accepted" stackId="a" fill="hsl(142 71% 45%)" name="Accepted" />
                  <Bar dataKey="rejected" stackId="a" fill="hsl(0 72% 55%)" name="Rejected" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Rejection breakdown */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Top rejection reasons
              </div>
              {/* Class breakdown */}
              {classBreakdown.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    By category
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {classBreakdown.map(({ cls, count, label, color }) => (
                      <Badge key={cls} variant="outline" className={`font-mono text-xs ${color}`}>
                        {label}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Top reasons */}
              {rejectionBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rejections in 24h.</p>
              ) : (
                <div className="space-y-2">
                  {rejectionBreakdown.map(({ reason, count, cls }) => {
                    const pct = totalRejected > 0 ? (count / totalRejected) * 100 : 0;
                    const meta = CLASS_META[cls] || CLASS_META.UNKNOWN;
                    return (
                      <div key={reason}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="flex items-center gap-1.5 truncate pr-2" title={reason}>
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.bg}`} />
                            {formatReasonLabel(reason)}
                          </span>
                          <span className="font-mono text-muted-foreground shrink-0">
                            {count} ({pct.toFixed(0)}%)
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-secondary rounded overflow-hidden">
                          <div
                            className={`h-full ${meta.bg}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}