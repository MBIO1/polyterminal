import React, { useMemo } from 'react';
import { Calendar } from 'lucide-react';

const PRESETS = [
  { id: 'all', label: 'All Time', daysBack: null },
  { id: '7d', label: 'Last 7 Days', daysBack: 7 },
  { id: '14d', label: 'Last 14 Days', daysBack: 14 },
  { id: '30d', label: 'Last 30 Days', daysBack: 30 },
  { id: '90d', label: 'Last 90 Days', daysBack: 90 },
];

export default function TimeframeSelector({ trades, selected, onChange }) {
  const stats = useMemo(() => {
    const settled = trades.filter(t => t.outcome !== 'pending' && t.outcome !== 'cancelled');
    if (!settled.length) return { first: null, last: null, count: 0 };

    const sorted = [...settled].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    return {
      first: sorted[0]?.created_date,
      last: sorted[sorted.length - 1]?.created_date,
      count: settled.length,
    };
  }, [trades]);

  const getTradesInWindow = (preset) => {
    if (!preset.daysBack) return trades;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - preset.daysBack);
    const cutoffTime = cutoff.getTime();

    return trades.filter(t => new Date(t.created_date).getTime() >= cutoffTime);
  };

  const selectedPreset = PRESETS.find(p => p.id === selected);
  const tradesInWindow = getTradesInWindow(selectedPreset);
  const settledInWindow = tradesInWindow.filter(t => t.outcome !== 'pending' && t.outcome !== 'cancelled');

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Historical Timeframe</h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {PRESETS.map(preset => (
          <button
            key={preset.id}
            onClick={() => onChange(preset.id)}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              selected === preset.id
                ? 'bg-primary text-primary-foreground'
                : 'border border-border bg-secondary/30 text-muted-foreground hover:text-foreground'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg bg-secondary/40 px-3 py-2 text-xs font-mono text-muted-foreground space-y-1">
        <div className="flex justify-between">
          <span>Trades in window:</span>
          <span className="text-foreground font-bold">{settledInWindow.length}</span>
        </div>
        {stats.first && stats.last && (
          <div className="flex justify-between text-[10px]">
            <span>Period:</span>
            <span className="text-foreground/70">
              {new Date(stats.first).toLocaleDateString()} → {new Date(stats.last).toLocaleDateString()}
            </span>
          </div>
        )}
        {settledInWindow.length === 0 && (
          <div className="text-destructive mt-1">⚠ No trades in this timeframe</div>
        )}
      </div>
    </div>
  );
}