import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Radio, TrendingUp, Gauge, Activity } from 'lucide-react';
import Section from '@/components/arb/Section';
import StatTile from '@/components/arb/StatTile';
import StatusBadge from '@/components/arb/StatusBadge';
import EmptyState from '@/components/arb/EmptyState';
import { fmtUSD, fmtBps } from '@/lib/arbMath';
import SignalStatsPanel from '@/components/arb/SignalStatsPanel';
import ExecuteSignalsButton from '@/components/arb/ExecuteSignalsButton';

export default function ArbSignals() {
  const [minEdge, setMinEdge] = useState(0);
  const [pairFilter, setPairFilter] = useState('');

  const { data: signals = [], isLoading } = useQuery({
    queryKey: ['arb-signals'],
    queryFn: () => base44.entities.ArbSignal.list('-received_time', 500),
    refetchInterval: 5000,
  });

  const filtered = signals
    .filter(s => Math.abs(s.net_edge_bps || 0) >= minEdge)
    .filter(s => !pairFilter || (s.pair || '').toLowerCase().includes(pairFilter.toLowerCase()));

  const total = signals.length;
  const executed = signals.filter(s => s.status === 'executed').length;
  // Only average live opportunities (exclude rejected/expired legacy noise)
  const liveSignals = signals.filter(s => s.status !== 'rejected' && s.status !== 'expired');
  const avgEdge = liveSignals.length
    ? liveSignals.reduce((a, s) => a + (s.net_edge_bps || 0), 0) / liveSignals.length
    : 0;
  const avgLatency = liveSignals.length
    ? liveSignals.reduce((a, s) => a + (s.signal_age_ms || 0), 0) / liveSignals.length
    : 0;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Signal Feed</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            Live ingestion from droplet WS bot · OKX + Bybit basis carry · {total} signals logged
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <ExecuteSignalsButton />
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse-glow" />
            <span className="text-xs font-mono text-muted-foreground">auto-refresh 5s</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Total Signals" value={total} sub="All time" tone="primary" />
        <StatTile label="Executed" value={executed} sub={total ? `${((executed / total) * 100).toFixed(1)}%` : '—'} tone="positive" />
        <StatTile label="Avg Net Edge" value={fmtBps(avgEdge)} sub="Post-fees" tone={avgEdge >= 0 ? 'positive' : 'negative'} />
        <StatTile label="Avg Signal Age" value={`${avgLatency.toFixed(0)} ms`} sub="At ingest" tone={avgLatency < 200 ? 'positive' : 'warn'} />
      </div>

      <SignalStatsPanel />

      <Section title="Live Signals" subtitle="Filter by minimum net edge and/or pair">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            Min edge (bps)
            <input
              type="number"
              value={minEdge}
              onChange={e => setMinEdge(Number(e.target.value) || 0)}
              className="w-20 bg-secondary border border-border rounded px-2 py-1 text-xs font-mono text-foreground"
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            Pair
            <input
              type="text"
              value={pairFilter}
              placeholder="BTC-USDT"
              onChange={e => setPairFilter(e.target.value)}
              className="w-32 bg-secondary border border-border rounded px-2 py-1 text-xs font-mono text-foreground"
            />
          </label>
          <span className="text-xs font-mono text-muted-foreground ml-auto">{filtered.length} / {total}</span>
        </div>

        {isLoading ? (
          <div className="text-center py-10 text-xs font-mono text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No signals yet" subtitle="Start the droplet bot and POST qualified opportunities to /functions/ingestSignal" icon={Radio} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 px-2">Time</th>
                  <th className="text-left py-2 px-2">Pair</th>
                  <th className="text-left py-2 px-2">Buy → Sell</th>
                  <th className="text-right py-2 px-2">Raw bps</th>
                  <th className="text-right py-2 px-2">Net bps</th>
                  <th className="text-right py-2 px-2">Fillable</th>
                  <th className="text-right py-2 px-2">Age</th>
                  <th className="text-center py-2 px-2">Conf</th>
                  <th className="text-left py-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map(s => (
                  <tr key={s.id} className="border-b border-border hover:bg-secondary/30 transition-colors">
                    <td className="py-2 px-2 text-muted-foreground">
                      {new Date(s.received_time || s.created_date).toLocaleTimeString()}
                    </td>
                    <td className="py-2 px-2 text-foreground font-semibold">{s.pair}</td>
                    <td className="py-2 px-2 text-foreground">{s.buy_exchange} → {s.sell_exchange}</td>
                    <td className="py-2 px-2 text-right text-muted-foreground">{Number(s.raw_spread_bps || 0).toFixed(2)}</td>
                    <td className={`py-2 px-2 text-right font-semibold ${(s.net_edge_bps || 0) > 0 ? 'text-accent' : 'text-destructive'}`}>
                      {Number(s.net_edge_bps || 0).toFixed(2)}
                    </td>
                    <td className="py-2 px-2 text-right text-foreground">{fmtUSD(s.fillable_size_usd || 0, 0)}</td>
                    <td className={`py-2 px-2 text-right ${(s.signal_age_ms || 0) > 200 ? 'text-chart-4' : 'text-muted-foreground'}`}>
                      {s.signal_age_ms || 0}ms
                    </td>
                    <td className="py-2 px-2 text-center text-muted-foreground">{s.confirmed_exchanges || 1}/2</td>
                    <td className="py-2 px-2"><StatusBadge status={s.status === 'alerted' ? 'High' : s.status === 'executed' ? 'Completed' : s.status === 'expired' ? 'Failed' : 'Monitoring'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}