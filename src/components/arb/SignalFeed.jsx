import React from 'react';
import { Clock, Zap, CheckCircle2, XCircle, Timer, ChevronRight, Play } from 'lucide-react';

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

const STATUS_CONFIG = {
  detected:  { icon: Zap,          color: 'text-chart-4',          bg: 'bg-chart-4/10',     label: 'Detected' },
  alerted:   { icon: Zap,          color: 'text-primary',          bg: 'bg-primary/10',     label: 'Alerted' },
  executed:  { icon: CheckCircle2, color: 'text-accent',           bg: 'bg-accent/10',      label: 'Executed' },
  rejected:  { icon: XCircle,      color: 'text-destructive',      bg: 'bg-destructive/10', label: 'Rejected' },
  expired:   { icon: Timer,        color: 'text-muted-foreground', bg: 'bg-muted/30',       label: 'Expired' },
};

export default function SignalFeed({ signals = [], onSelect }) {
  return (
    <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
      {signals.map(s => {
        const cfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.detected;
        const Icon = cfg.icon;
        const edge = Number(s.net_edge_bps || 0);
        const pnl = s.executed_pnl_usd != null ? Number(s.executed_pnl_usd) : null;
        const isPending = s.status === 'detected' || s.status === 'alerted';

        return (
          <div
            key={s.id}
            onClick={() => onSelect?.(s)}
            className={`flex items-start gap-3 p-2.5 rounded-lg border border-border ${cfg.bg} transition-all cursor-pointer hover:border-primary/40 hover:brightness-110 group`}
          >
            <div className={`mt-0.5 flex-shrink-0 ${cfg.color}`}>
              <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-foreground">{s.pair}</span>
                <span className={`text-xs font-mono font-bold ${edge >= 20 ? 'text-accent' : edge >= 10 ? 'text-chart-4' : 'text-muted-foreground'}`}>
                  {edge.toFixed(1)} bps
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {s.buy_exchange} → {s.sell_exchange}
                </span>
                {pnl !== null && (
                  <span className={`text-[10px] font-mono font-bold ${pnl >= 0 ? 'text-accent' : 'text-destructive'}`}>
                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                  </span>
                )}
              </div>
              {s.rejection_reason && (
                <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">{s.rejection_reason}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isPending && (
                <span className="text-[10px] font-mono text-primary flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Play className="w-2.5 h-2.5" /> Execute
                </span>
              )}
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
              <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {timeAgo(s.received_time || s.created_date)}
              </span>
              <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        );
      })}
    </div>
  );
}