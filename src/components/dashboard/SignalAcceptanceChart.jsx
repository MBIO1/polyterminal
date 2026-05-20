import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { base44 } from '@/api/base44Client';

const ACCEPTED_STATUSES = new Set(['detected', 'alerted', 'executed']);
const REJECTED_STATUSES = new Set(['rejected', 'expired']);

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
    .map(([reason, count]) => ({ reason, count }));
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
  const rejectionBreakdown = buildRejectionBreakdown(
    signals.filter(s => {
      const t = new Date(s.received_time || s.signal_time || s.created_date).getTime();
      return t && t >= Date.now() - 24 * 60 * 60 * 1000;
    })
  );

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
              {rejectionBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rejections in 24h.</p>
              ) : (
                <div className="space-y-2">
                  {rejectionBreakdown.map(({ reason, count }) => {
                    const pct = totalRejected > 0 ? (count / totalRejected) * 100 : 0;
                    return (
                      <div key={reason}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="truncate pr-2" title={reason}>{reason}</span>
                          <span className="font-mono text-muted-foreground shrink-0">
                            {count} ({pct.toFixed(0)}%)
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-secondary rounded overflow-hidden">
                          <div
                            className="h-full bg-red-500/60"
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