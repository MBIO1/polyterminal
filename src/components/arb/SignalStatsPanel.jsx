import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import Section from '@/components/arb/Section';
import EmptyState from '@/components/arb/EmptyState';
import { Gauge } from 'lucide-react';

export default function SignalStatsPanel() {
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await base44.functions.invoke('signalStats', { window_hours: 24 });
        if (!cancelled) setStats(res?.data?.pairs || []);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <Section title="Per-Pair Performance" subtitle="Rolling 24h · win rate drives adaptive threshold recommendation">
      {loading ? (
        <div className="text-center py-6 text-xs font-mono text-muted-foreground">Loading stats…</div>
      ) : stats.length === 0 ? (
        <EmptyState title="No pair stats yet" subtitle="Stats populate once signals are ingested and tagged executed." icon={Gauge} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-2 px-2">Pair</th>
                <th className="text-right py-2 px-2">Signals</th>
                <th className="text-right py-2 px-2">Executed</th>
                <th className="text-right py-2 px-2">Win rate</th>
                <th className="text-right py-2 px-2">Avg signal bps</th>
                <th className="text-right py-2 px-2">Avg realized bps</th>
                <th className="text-right py-2 px-2">Avg slippage</th>
                <th className="text-right py-2 px-2">Recommended min</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s => (
                <tr key={s.pair} className="border-b border-border">
                  <td className="py-2 px-2 text-foreground font-semibold">{s.pair}</td>
                  <td className="py-2 px-2 text-right text-foreground">{s.total_signals}</td>
                  <td className="py-2 px-2 text-right text-foreground">{s.executed}</td>
                  <td className={`py-2 px-2 text-right font-semibold ${s.win_rate === null ? 'text-muted-foreground' : s.win_rate >= 0.6 ? 'text-accent' : 'text-destructive'}`}>
                    {s.win_rate === null ? '—' : `${(s.win_rate * 100).toFixed(1)}%`}
                  </td>
                  <td className="py-2 px-2 text-right text-muted-foreground">{s.avg_signal_edge_bps.toFixed(2)}</td>
                  <td className="py-2 px-2 text-right text-muted-foreground">{s.avg_realized_bps === null ? '—' : s.avg_realized_bps.toFixed(2)}</td>
                  <td className="py-2 px-2 text-right text-muted-foreground">{s.avg_slippage_bps === null ? '—' : s.avg_slippage_bps.toFixed(2)}</td>
                  <td className={`py-2 px-2 text-right font-semibold ${s.recommended_min_bps ? 'text-chart-4' : 'text-muted-foreground'}`}>
                    {s.recommended_min_bps ? `${s.recommended_min_bps} bps ↑` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}