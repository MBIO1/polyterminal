import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { BarChart3, TrendingUp, Activity, Target } from 'lucide-react';
import Section from '@/components/arb/Section';
import StatTile from '@/components/arb/StatTile';
import VenueConnectivityPanel from '@/components/arb/VenueConnectivityPanel';
import DailyPnlBarChart from '@/components/arb/DailyPnlBarChart';
import DailyBasisChart from '@/components/arb/DailyBasisChart';
import TradeFrequencyChart from '@/components/arb/TradeFrequencyChart';
import { fmtUSD, fmtBps } from '@/lib/arbMath';

// Group signals by UTC YYYY-MM-DD
function aggregateByDay(signals) {
  const map = new Map();
  for (const s of signals) {
    const ts = s.received_time || s.created_date;
    if (!ts) continue;
    const date = new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD
    if (!map.has(date)) {
      map.set(date, { date, signals: 0, executed: 0, edgeSum: 0, pnlSum: 0, pnlCount: 0 });
    }
    const row = map.get(date);
    row.signals += 1;
    if (s.status === 'executed') row.executed += 1;
    row.edgeSum += Number(s.net_edge_bps || 0);
    if (s.executed_pnl_usd != null) {
      row.pnlSum += Number(s.executed_pnl_usd || 0);
      row.pnlCount += 1;
    }
  }
  return Array.from(map.values())
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(r => ({
      date: r.date,
      label: r.date.slice(5), // MM-DD
      signals: r.signals,
      executed: r.executed,
      avgEdge: r.signals ? r.edgeSum / r.signals : 0,
      pnl: r.pnlSum,
    }));
}

export default function ArbBotAnalytics() {
  const { data: signals = [], isLoading } = useQuery({
    queryKey: ['bot-analytics-signals'],
    queryFn: () => base44.entities.ArbSignal.list('-received_time', 2000),
    refetchInterval: 15000,
  });

  const daily = useMemo(() => aggregateByDay(signals), [signals]);
  const last30 = daily.slice(-30);

  const totalSignals = signals.length;
  const executedCount = signals.filter(s => s.status === 'executed').length;
  const totalPnl = signals.reduce((a, s) => a + Number(s.executed_pnl_usd || 0), 0);
  const avgEdgeAll = signals.length
    ? signals.reduce((a, s) => a + Number(s.net_edge_bps || 0), 0) / signals.length
    : 0;
  const activeDays = daily.length;
  const signalsPerDay = activeDays ? totalSignals / activeDays : 0;

  // Rows for DailyPnlBarChart (expects {date, pnl})
  const pnlRows = last30.map(d => ({ date: d.date, pnl: d.pnl }));

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bot Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            Historical view of droplet bot output · {totalSignals} signals across {activeDays} day{activeDays === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse-glow" />
          <span className="text-xs font-mono text-muted-foreground">auto-refresh 15s</span>
        </div>
      </header>

      <VenueConnectivityPanel />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          label="Total Signals"
          value={totalSignals}
          sub={`${signalsPerDay.toFixed(1)}/day avg`}
          tone="primary"
        />
        <StatTile
          label="Executed"
          value={executedCount}
          sub={totalSignals ? `${((executedCount / totalSignals) * 100).toFixed(1)}%` : '—'}
          tone="positive"
        />
        <StatTile
          label="Realized PnL"
          value={fmtUSD(totalPnl)}
          sub="From executed signals"
          tone={totalPnl >= 0 ? 'positive' : 'negative'}
        />
        <StatTile
          label="Avg Net Edge"
          value={fmtBps(avgEdgeAll)}
          sub="Post-fees, all signals"
          tone={avgEdgeAll >= 0 ? 'positive' : 'negative'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section
          title="Daily Profit"
          subtitle="Net PnL per day (last 30 days)"
        >
          <DailyPnlBarChart rows={pnlRows} days={30} />
        </Section>

        <Section
          title="Signal Frequency"
          subtitle="Signals posted vs executed per day"
        >
          <TradeFrequencyChart data={last30} />
          <div className="flex items-center gap-4 mt-3 text-[10px] font-mono text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-chart-1" /> Posted
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-accent" /> Executed
            </span>
          </div>
        </Section>
      </div>

      <Section
        title="Avg Basis Capture Over Time"
        subtitle="Daily average net edge (bps, post-fees) across all signals"
      >
        <DailyBasisChart data={last30} />
      </Section>

      {isLoading && (
        <div className="text-center py-4 text-xs font-mono text-muted-foreground">
          Loading historical signals…
        </div>
      )}
    </div>
  );
}