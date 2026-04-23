import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle, Activity, Zap, Radio, Scale, Clock } from 'lucide-react';
import Section from '@/components/arb/Section';
import { fmtUSD, fmtBps } from '@/lib/arbMath';

const VERDICT = {
  healthy: { icon: CheckCircle2, color: 'text-accent', bg: 'bg-accent/10 border-accent/30', label: 'HEALTHY' },
  degraded: { icon: AlertTriangle, color: 'text-chart-4', bg: 'bg-chart-4/10 border-chart-4/30', label: 'DEGRADED' },
  critical: { icon: XCircle, color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30', label: 'CRITICAL' },
};

function Row({ icon: Icon, label, value, sub, tone = 'neutral' }) {
  const toneClass = {
    positive: 'text-accent',
    negative: 'text-destructive',
    warn: 'text-chart-4',
    primary: 'text-primary',
    neutral: 'text-foreground',
  }[tone];
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary/30 border border-border">
      <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
        <div className={`text-sm font-semibold font-mono mt-0.5 truncate ${toneClass}`}>{value}</div>
        {sub && <div className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  );
}

export default function SystemAuditPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['system-audit'],
    queryFn: async () => {
      try {
        const res = await base44.functions.invoke('systemAudit', {});
        return res?.data;
      } catch (e) {
        console.error('systemAudit error:', e);
        throw e;
      }
    },
    refetchInterval: 5_000, // continuous audit
    retry: 2,
    staleTime: 3_000,
  });

  if (isLoading) {
    return (
      <Section title="System Audit" subtitle="Loading live state…">
        <div className="h-32 flex items-center justify-center text-xs font-mono text-muted-foreground">
          Running audit…
        </div>
      </Section>
    );
  }

  if (error || !data) {
    return (
      <Section title="System Audit" subtitle="Error loading audit">
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-xs font-mono text-destructive">
          {error?.message || 'Failed to load system audit'}
        </div>
      </Section>
    );
  }

  const verdict = VERDICT[data.verdict] || VERDICT.degraded;
  const VerdictIcon = verdict.icon;
  const lastHour = data.signals?.last_hour || {};
  const pending = data.signals?.pending || [];
  const recent = data.trades?.last_10 || [];

  return (
    <Section
      title="System Audit"
      subtitle="Continuous roll-up of config, signals, execution, positions · refresh 5s"
      action={
        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-md border ${verdict.bg}`}>
          <VerdictIcon className={`w-4 h-4 ${verdict.color}`} />
          <span className={`text-xs font-mono font-bold tracking-wider ${verdict.color}`}>{verdict.label}</span>
        </div>
      }
    >
      {data.issues?.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
          <div className="text-xs font-mono text-destructive">
            Issues: {data.issues.join(' · ')}
          </div>
        </div>
      )}

      {/* Top-level vitals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Row
          icon={Zap}
          label="Bot"
          value={data.config.bot_running ? 'RUNNING' : 'IDLE'}
          sub={`${data.config.paper_trading ? 'paper' : 'LIVE'}${data.config.kill_switch_active ? ' · KILL' : ''}`}
          tone={data.config.bot_running && !data.config.kill_switch_active ? 'positive' : 'warn'}
        />
        <Row
          icon={Radio}
          label="Heartbeat"
          value={data.heartbeat.healthy ? `${data.heartbeat.last_age_sec}s ago` : 'STALE'}
          sub={`best ${fmtBps(data.heartbeat.best_edge_bps)} · posted ${data.heartbeat.posted}`}
          tone={data.heartbeat.healthy ? 'positive' : 'negative'}
        />
        <Row
          icon={Activity}
          label="Today PnL"
          value={fmtUSD(data.trades.today_pnl_usd)}
          sub={`${data.trades.today_count} trades · ${data.trades.open_count} open`}
          tone={data.trades.today_pnl_usd >= 0 ? 'positive' : 'negative'}
        />
        <Row
          icon={Scale}
          label="Net Delta"
          value={fmtUSD(data.positions.net_delta_usd)}
          sub={`cap ${fmtUSD(data.positions.drift_cap_usd)} · util ${data.positions.margin_util_pct}%`}
          tone={data.positions.within_drift ? 'positive' : 'negative'}
        />
      </div>

      {/* Signal flow (last hour) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Row icon={Radio} label="Signals 1h" value={lastHour.signals ?? 0} tone="primary" />
        <Row icon={CheckCircle2} label="Executed 1h" value={lastHour.executed ?? 0} tone="positive" />
        <Row icon={XCircle} label="Rejected 1h" value={lastHour.rejected ?? 0} tone={lastHour.rejected > 0 ? 'warn' : 'neutral'} />
        <Row
          icon={Activity}
          label="Exec Rate"
          value={`${((lastHour.execution_rate || 0) * 100).toFixed(0)}%`}
          tone={(lastHour.execution_rate || 0) >= 0.5 ? 'positive' : 'warn'}
        />
        <Row
          icon={Clock}
          label="Pending"
          value={pending.length}
          sub={pending.length ? `oldest ${pending[pending.length - 1].age_sec}s` : 'queue empty'}
          tone={pending.length > 5 ? 'warn' : 'neutral'}
        />
      </div>

      {/* Two-column: pending queue + recent executions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Pending Queue</div>
            <Link to="/monitor" className="text-[10px] font-mono text-primary hover:underline">monitor →</Link>
          </div>
          {pending.length === 0 ? (
            <div className="text-xs font-mono text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg">
              No pending signals
            </div>
          ) : (
            <div className="space-y-1">
              {pending.slice(0, 5).map(p => (
                <div key={p.id} className="flex items-center justify-between text-xs font-mono p-2 rounded border border-border bg-secondary/20">
                  <span className="text-foreground font-semibold">{p.pair}</span>
                  <span className={p.net_edge_bps >= 0 ? 'text-accent' : 'text-destructive'}>
                    {p.net_edge_bps.toFixed(2)} bps
                  </span>
                  <span className="text-muted-foreground">{fmtUSD(p.fillable_size_usd, 0)}</span>
                  <span className="text-muted-foreground">{p.age_sec}s</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Recent Executions</div>
            <Link to="/trades" className="text-[10px] font-mono text-primary hover:underline">trades →</Link>
          </div>
          {recent.length === 0 ? (
            <div className="text-xs font-mono text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg">
              No trades yet
            </div>
          ) : (
            <div className="space-y-1">
              {recent.slice(0, 5).map(t => (
                <div key={t.trade_id} className="flex items-center justify-between text-xs font-mono p-2 rounded border border-border bg-secondary/20">
                  <span className="text-foreground font-semibold truncate flex-1">{t.trade_id}</span>
                  <span className="text-muted-foreground w-10">{t.asset}</span>
                  <span className={`w-20 text-right ${t.net_pnl >= 0 ? 'text-accent' : 'text-destructive'}`}>
                    {fmtUSD(t.net_pnl)}
                  </span>
                  <span className="text-muted-foreground w-10 text-right">{t.mode}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {data.signals.top_reject_reasons?.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Rejection reasons (1h)</div>
          <div className="flex flex-wrap gap-2">
            {data.signals.top_reject_reasons.map(r => (
              <span key={r.reason} className="text-[11px] font-mono px-2 py-1 rounded bg-secondary border border-border">
                <span className="text-foreground">{r.reason}</span>
                <span className="text-muted-foreground ml-1">× {r.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}