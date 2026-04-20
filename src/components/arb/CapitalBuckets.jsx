import React from 'react';
import { fmtUSD } from '@/lib/arbMath';

export default function CapitalBuckets({ config }) {
  const total = Number(config?.total_capital || 0);
  const buckets = [
    { key: 'reserve', label: 'Reserve', pct: config?.reserve_pct, tone: 'text-muted-foreground' },
    { key: 'spot', label: 'Spot', pct: config?.spot_allocation_pct, tone: 'text-primary' },
    { key: 'perp', label: 'Perp Collateral', pct: config?.perp_collateral_pct, tone: 'text-accent' },
    { key: 'buffer', label: 'Execution Buffer', pct: config?.execution_buffer_pct, tone: 'text-chart-4' },
  ];
  const deployable = total * (1 - (Number(config?.reserve_pct) || 0));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">Deployable</p>
          <p className="text-xl font-mono font-semibold text-foreground">{fmtUSD(deployable, 0)}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">Total Capital</p>
          <p className="text-xl font-mono font-semibold text-foreground">{fmtUSD(total, 0)}</p>
        </div>
      </div>

      {/* Stacked bar */}
      <div className="flex h-2.5 rounded-full overflow-hidden bg-secondary">
        {buckets.map(b => {
          const pct = Number(b.pct || 0) * 100;
          if (!pct) return null;
          const bg = {
            reserve: 'bg-muted-foreground/40',
            spot: 'bg-primary',
            perp: 'bg-accent',
            buffer: 'bg-chart-4',
          }[b.key];
          return <div key={b.key} className={bg} style={{ width: `${pct}%` }} />;
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {buckets.map(b => {
          const pct = Number(b.pct || 0);
          const usd = total * pct;
          return (
            <div key={b.key} className="p-3 rounded-lg border border-border bg-secondary/30">
              <p className={`text-[10px] font-mono uppercase tracking-widest ${b.tone}`}>{b.label}</p>
              <p className="text-sm font-mono font-semibold text-foreground mt-1">{fmtUSD(usd, 0)}</p>
              <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{(pct * 100).toFixed(1)}%</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}