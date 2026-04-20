import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import StatusBadge from '@/components/arb/StatusBadge';

const STAGES = ['Planned', 'Open', 'Closed', 'Cancelled', 'Error'];

export default function TradeLifecycleTile({ trades = [] }) {
  const counts = STAGES.reduce((acc, s) => {
    acc[s] = trades.filter(t => t.status === s).length;
    return acc;
  }, {});

  // most recent transition — pick by updated_date or entry/exit timestamp
  const recent = [...trades]
    .filter(t => t.updated_date || t.entry_timestamp)
    .sort((a, b) => new Date(b.updated_date || b.entry_timestamp) - new Date(a.updated_date || a.entry_timestamp))
    .slice(0, 3);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2">
        {STAGES.map(stage => (
          <div key={stage} className="rounded-lg border border-border bg-secondary/30 p-3 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{stage}</div>
            <div className="text-xl font-bold text-foreground mt-1">{counts[stage]}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
          Recent transitions
        </div>
        {recent.length === 0 ? (
          <p className="text-xs font-mono text-muted-foreground py-4 text-center">No trade activity yet</p>
        ) : (
          <div className="space-y-1.5">
            {recent.map(t => {
              const ts = t.updated_date || t.entry_timestamp;
              return (
                <div key={t.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/30 border border-border">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-mono font-bold text-primary shrink-0">{t.trade_id}</span>
                    <StatusBadge status={t.status} />
                    <span className="text-[10px] font-mono text-muted-foreground truncate">
                      {t.asset} · {t.strategy}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0 ml-2">
                    {ts ? formatDistanceToNow(new Date(ts), { addSuffix: true }) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}