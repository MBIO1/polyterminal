import React from 'react';

export default function StatTile({ label, value, sub, tone = 'default' }) {
  const toneCls = {
    default: 'text-foreground',
    positive: 'text-accent',
    negative: 'text-destructive',
    warn: 'text-chart-4',
    primary: 'text-primary',
  }[tone] || 'text-foreground';
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1.5 text-2xl font-sans font-semibold tracking-tight ${toneCls}`}>{value}</p>
      {sub && <p className="text-[11px] font-mono text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}