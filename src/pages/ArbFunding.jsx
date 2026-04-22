import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Percent, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import Section from '@/components/arb/Section';
import StatTile from '@/components/arb/StatTile';
import EmptyState from '@/components/arb/EmptyState';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function ArbFunding() {
  const qc = useQueryClient();
  const [onlyQualifying, setOnlyQualifying] = useState(true);

  const { data: config } = useQuery({
    queryKey: ['arb-config'],
    queryFn: async () => (await base44.entities.ArbConfig.list('-created_date', 1))[0],
  });

  const { data: opps = [], isLoading } = useQuery({
    queryKey: ['funding-opps'],
    queryFn: () => base44.entities.ArbFundingOpportunity.list('-snapshot_time', 300),
    refetchInterval: 30_000,
  });

  // Keep only the latest snapshot per venue+pair
  const latest = {};
  for (const o of opps) {
    const k = `${o.venue}|${o.pair}`;
    if (!latest[k] || new Date(o.snapshot_time) > new Date(latest[k].snapshot_time)) latest[k] = o;
  }
  const rows = Object.values(latest)
    .filter(r => !onlyQualifying || r.qualifies)
    .sort((a, b) => Math.abs(b.annualized_apr_bps) - Math.abs(a.annualized_apr_bps));

  const scanMutation = useMutation({
    mutationFn: () => base44.functions.invoke('scanFunding', {}),
    onSuccess: (res) => {
      const data = res.data || {};
      toast.success(`Scanned ${data.scanned || 0} · ${data.qualifying || 0} qualify`);
      qc.invalidateQueries({ queryKey: ['funding-opps'] });
    },
    onError: (e) => toast.error(e.message || 'Scan failed'),
  });

  const minApr = Number(config?.funding_min_apr_bps ?? 1000);
  const exitApr = Number(config?.funding_exit_apr_bps ?? 500);
  const totalQualifying = Object.values(latest).filter(r => r.qualifies).length;
  const bestApr = rows[0]?.annualized_apr_bps || 0;
  const lastSnap = opps[0]?.snapshot_time;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Funding Capture</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            Delta-neutral spot + perp · collect funding payments every 8h
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          className="gap-2"
        >
          <RefreshCw className={`w-3 h-3 ${scanMutation.isPending ? 'animate-spin' : ''}`} />
          Scan Now
        </Button>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Min APR Entry" value={`${(minApr / 100).toFixed(2)}%`} sub="From config" tone="primary" />
        <StatTile label="Exit APR" value={`${(exitApr / 100).toFixed(2)}%`} sub="Drops below this = close" tone="warn" />
        <StatTile label="Qualifying Now" value={totalQualifying} sub={`of ${Object.keys(latest).length} scanned`} tone={totalQualifying > 0 ? 'positive' : 'muted'} />
        <StatTile label="Best APR" value={`${(Math.abs(bestApr) / 100).toFixed(2)}%`} sub={rows[0] ? `${rows[0].venue} ${rows[0].pair}` : '—'} tone={Math.abs(bestApr) >= minApr ? 'positive' : 'muted'} />
      </div>

      <Section
        title="Live Funding Rates"
        subtitle={lastSnap ? `Last snapshot: ${new Date(lastSnap).toLocaleTimeString()} · auto-refresh 30s` : 'No snapshots yet — click Scan Now'}
        action={
          <label className="flex items-center gap-2 text-xs font-mono text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={onlyQualifying}
              onChange={e => setOnlyQualifying(e.target.checked)}
              className="accent-primary"
            />
            Only qualifying
          </label>
        }
      >
        {isLoading ? (
          <div className="text-center py-10 text-xs font-mono text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={onlyQualifying ? 'No qualifying opportunities' : 'No funding data yet'}
            subtitle={onlyQualifying ? `No pair currently pays ≥ ${(minApr / 100).toFixed(2)}% APR. Uncheck filter to see all rates.` : 'Click "Scan Now" to fetch funding rates.'}
            icon={Percent}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 px-2">Venue</th>
                  <th className="text-left py-2 px-2">Pair</th>
                  <th className="text-right py-2 px-2">Funding Rate (8h)</th>
                  <th className="text-right py-2 px-2">Annualized APR</th>
                  <th className="text-left py-2 px-2">Capture Direction</th>
                  <th className="text-right py-2 px-2">Next Funding</th>
                  <th className="text-center py-2 px-2">Qualifies</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const aprPct = r.annualized_apr_bps / 100;
                  const absApr = Math.abs(r.annualized_apr_bps);
                  return (
                    <tr key={`${r.venue}-${r.pair}`} className="border-b border-border hover:bg-secondary/30 transition-colors">
                      <td className="py-2 px-2 text-foreground">{r.venue}</td>
                      <td className="py-2 px-2 text-foreground font-semibold">{r.pair}</td>
                      <td className="py-2 px-2 text-right text-muted-foreground">
                        {(r.funding_rate * 100).toFixed(4)}%
                      </td>
                      <td className={`py-2 px-2 text-right font-semibold ${absApr >= minApr ? 'text-accent' : 'text-muted-foreground'}`}>
                        {aprPct >= 0 ? '+' : ''}{aprPct.toFixed(2)}%
                      </td>
                      <td className="py-2 px-2">
                        <span className="flex items-center gap-1 text-foreground">
                          {r.direction === 'short_perp' ? (
                            <><TrendingDown className="w-3 h-3 text-accent" /> Long spot / Short perp</>
                          ) : (
                            <><TrendingUp className="w-3 h-3 text-chart-4" /> Short spot / Long perp</>
                          )}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-muted-foreground">
                        {r.next_funding_time ? new Date(r.next_funding_time).toLocaleTimeString() : '—'}
                      </td>
                      <td className="py-2 px-2 text-center">
                        {r.qualifies ? (
                          <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse-glow" />
                        ) : (
                          <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Strategy Rules" subtitle="How funding capture works">
        <div className="space-y-3 text-xs font-mono text-muted-foreground leading-relaxed">
          <p><span className="text-accent font-semibold">Entry:</span> When annualized funding APR ≥ <span className="text-foreground">{(minApr / 100).toFixed(2)}%</span>, open a delta-neutral pair: buy spot and short perp (positive funding) or short spot and long perp (negative funding).</p>
          <p><span className="text-chart-4 font-semibold">Exit:</span> Close when APR drops below <span className="text-foreground">{(exitApr / 100).toFixed(2)}%</span>{config?.funding_exit_on_flip ? ' OR funding flips sign' : ''}.</p>
          <p><span className="text-primary font-semibold">PnL:</span> Collect funding every 8h on the perp leg while spot hedge keeps delta at zero. Price movements cancel between the two legs.</p>
          <p><span className="text-muted-foreground">Max per position:</span> <span className="text-foreground">${config?.funding_max_position_usd ?? 200}</span> (adjust in Config).</p>
        </div>
      </Section>
    </div>
  );
}