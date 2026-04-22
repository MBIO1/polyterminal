import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Radio, Play, Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import Section from '@/components/arb/Section';
import StatTile from '@/components/arb/StatTile';
import StatusBadge from '@/components/arb/StatusBadge';
import EmptyState from '@/components/arb/EmptyState';
import { fmtUSD } from '@/lib/arbMath';

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export default function ArbSignalMonitor() {
  const queryClient = useQueryClient();
  const [executing, setExecuting] = useState(new Set());

  const { data: signals = [], isLoading } = useQuery({
    queryKey: ['arb-signals-pending'],
    queryFn: async () => {
      const list = await base44.entities.ArbSignal.list('-received_time', 200);
      return list.filter(s => s.status === 'detected' || s.status === 'alerted');
    },
    refetchInterval: 2000, // Fast polling — real-time monitor
  });

  const forceExecute = async (signalId, pair) => {
    setExecuting(prev => new Set(prev).add(signalId));
    try {
      const res = await base44.functions.invoke('executeSignals', {
        signal_id: signalId,
        dry_run: false,
      });
      const result = res?.data?.results?.[0];
      if (result?.decision === 'executed') {
        toast.success(`${pair} executed`, {
          description: `Trade ${result.trade_id} · PnL ${result.net_pnl_usd >= 0 ? '+' : ''}$${result.net_pnl_usd}`,
        });
      } else if (result?.decision === 'rejected') {
        toast.error(`${pair} rejected`, {
          description: (result.reasons || []).join(', '),
        });
      } else if (result?.decision === 'error') {
        toast.error(`${pair} error`, { description: result.error });
      } else {
        toast.info(`${pair}: ${result?.decision || 'no result'}`);
      }
      queryClient.invalidateQueries({ queryKey: ['arb-signals-pending'] });
    } catch (e) {
      toast.error(`Execution failed`, { description: e.message });
    } finally {
      setExecuting(prev => {
        const next = new Set(prev);
        next.delete(signalId);
        return next;
      });
    }
  };

  const detected = signals.filter(s => s.status === 'detected').length;
  const alerted = signals.filter(s => s.status === 'alerted').length;
  const oldest = signals.length ? signals[signals.length - 1] : null;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Live Signal Monitor</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            Real-time queue of detected/alerted signals · force-execute individually
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse-glow" />
          <span className="text-xs font-mono text-muted-foreground">polling every 2s</span>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Pending" value={signals.length} sub="Awaiting execution" tone="primary" />
        <StatTile label="Detected" value={detected} sub="Standard signals" tone="neutral" />
        <StatTile label="Alerted" value={alerted} sub="High-edge flagged" tone="warn" />
        <StatTile
          label="Oldest in queue"
          value={oldest ? timeAgo(oldest.received_time || oldest.created_date) : '—'}
          sub={oldest ? oldest.pair : 'Queue empty'}
          tone={oldest && Date.now() - new Date(oldest.received_time || oldest.created_date).getTime() > 30_000 ? 'negative' : 'positive'}
        />
      </div>

      <Section title="Pending Signals" subtitle="Click Force Execute to route a specific signal through the executor (respects all gates)">
        {isLoading ? (
          <div className="text-center py-10 text-xs font-mono text-muted-foreground">Loading…</div>
        ) : signals.length === 0 ? (
          <EmptyState
            title="No pending signals"
            subtitle="All recent signals have been processed. New ones will appear here within 2 seconds of arrival."
            icon={Radio}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 px-2">Age</th>
                  <th className="text-left py-2 px-2">Pair</th>
                  <th className="text-left py-2 px-2">Buy → Sell</th>
                  <th className="text-right py-2 px-2">Net bps</th>
                  <th className="text-right py-2 px-2">Fillable</th>
                  <th className="text-center py-2 px-2">Conf</th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-right py-2 px-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {signals.map(s => {
                  const isBusy = executing.has(s.id);
                  return (
                    <tr key={s.id} className="border-b border-border hover:bg-secondary/30 transition-colors">
                      <td className="py-2 px-2 text-muted-foreground flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        {timeAgo(s.received_time || s.created_date)}
                      </td>
                      <td className="py-2 px-2 text-foreground font-semibold">{s.pair}</td>
                      <td className="py-2 px-2 text-foreground">{s.buy_exchange} → {s.sell_exchange}</td>
                      <td className={`py-2 px-2 text-right font-semibold ${(s.net_edge_bps || 0) > 0 ? 'text-accent' : 'text-destructive'}`}>
                        {Number(s.net_edge_bps || 0).toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-right text-foreground">{fmtUSD(s.fillable_size_usd || 0, 0)}</td>
                      <td className="py-2 px-2 text-center text-muted-foreground">{s.confirmed_exchanges || 1}/2</td>
                      <td className="py-2 px-2">
                        <StatusBadge status={s.status === 'alerted' ? 'High' : 'Monitoring'} />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <button
                          onClick={() => forceExecute(s.id, s.pair)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isBusy ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Executing…
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3" />
                              Force Execute
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}