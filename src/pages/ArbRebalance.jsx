import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Scale, Zap, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import Section from '@/components/arb/Section';
import StatTile from '@/components/arb/StatTile';
import EmptyState from '@/components/arb/EmptyState';
import { fmtUSD, fmtPct } from '@/lib/arbMath';

export default function ArbRebalance() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const { data: preview, isLoading, refetch } = useQuery({
    queryKey: ['rebalance-preview'],
    queryFn: async () => {
      const res = await base44.functions.invoke('generateRebalanceSignals', { dry_run: true });
      return res?.data;
    },
    refetchInterval: 10_000,
  });

  const runRebalance = async () => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke('generateRebalanceSignals', { dry_run: false });
      const data = res?.data;
      setLastResult(data);
      if (data?.created?.length) {
        toast.success(`Rebalance planned`, {
          description: `${data.created.length} transfer(s) created. Total drift: $${data.total_delta_usd}`,
        });
      } else {
        toast.info('No rebalance needed', {
          description: data?.message || 'Book is within threshold.',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['rebalance-preview'] });
    } catch (e) {
      toast.error('Rebalance failed', { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  const totalDelta = preview?.total_delta_usd ?? 0;
  const cap = preview?.drift_cap_usd ?? 0;
  const within = preview?.within_threshold ?? true;
  const plan = preview?.plan || [];
  const byAsset = preview?.by_asset || {};

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            <Scale className="w-7 h-7 text-primary" />
            Rebalance Assistant
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            Monitors open-position delta drift · generates swap signals to stay within ArbConfig threshold
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse-glow" />
          <span className="text-xs font-mono text-muted-foreground">refresh 10s</span>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          label="Net Delta Drift"
          value={fmtUSD(totalDelta)}
          sub={`${Math.abs(totalDelta) > cap ? 'Above' : 'Within'} threshold`}
          tone={within ? 'positive' : 'negative'}
        />
        <StatTile
          label="Drift Cap"
          value={fmtUSD(cap)}
          sub={fmtPct(preview?.total_capital ? cap / preview.total_capital : 0)}
          tone="primary"
        />
        <StatTile
          label="Status"
          value={within ? 'OK' : 'BREACH'}
          sub={within ? 'Book is balanced' : 'Rebalance advised'}
          tone={within ? 'positive' : 'warn'}
        />
        <StatTile
          label="Planned Legs"
          value={plan.length}
          sub={plan.length ? 'Ready to create' : 'Nothing to do'}
          tone={plan.length ? 'warn' : 'neutral'}
        />
      </div>

      <Section
        title="Quick Rebalance"
        subtitle="One-click generates Planned ArbTransfer records to flatten per-asset delta. Review in Transfers tab before executing at exchange."
        action={
          <button
            onClick={runRebalance}
            disabled={busy || plan.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {busy ? 'Generating…' : 'Quick Rebalance'}
          </button>
        }
      >
        {isLoading ? (
          <div className="text-center py-8 text-xs font-mono text-muted-foreground">Loading…</div>
        ) : plan.length === 0 ? (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-accent/5 border border-accent/20">
            <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" />
            <div>
              <div className="text-sm font-semibold text-foreground">Book is balanced</div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">
                No per-asset delta exceeds the $50 rebalance threshold.
              </div>
            </div>
          </div>
        ) : (
          <>
            {!within && (
              <div className="flex items-center gap-3 p-4 mb-4 rounded-lg bg-destructive/5 border border-destructive/20">
                <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Net delta {fmtUSD(totalDelta)} exceeds cap {fmtUSD(cap)}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    Run Quick Rebalance to create {plan.length} corrective transfer(s).
                  </div>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-2 px-2">Asset</th>
                    <th className="text-right py-2 px-2">Current Delta</th>
                    <th className="text-left py-2 px-2">Action</th>
                    <th className="text-right py-2 px-2">Target USD</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map(leg => (
                    <tr key={leg.asset} className="border-b border-border hover:bg-secondary/30 transition-colors">
                      <td className="py-2 px-2 text-foreground font-semibold">{leg.asset}</td>
                      <td className={`py-2 px-2 text-right ${leg.current_delta_usd >= 0 ? 'text-accent' : 'text-destructive'}`}>
                        {fmtUSD(leg.current_delta_usd)}
                      </td>
                      <td className="py-2 px-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                          leg.action === 'Rebalance Sell' ? 'bg-destructive/10 text-destructive' : 'bg-accent/10 text-accent'
                        }`}>
                          {leg.action}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-foreground">{fmtUSD(leg.target_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {Object.keys(byAsset).length > 0 && (
        <Section title="Per-Asset Delta Breakdown" subtitle="Signed USD delta across all open positions">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(byAsset).map(([asset, delta]) => (
              <div key={asset} className="p-3 rounded-lg bg-secondary/30 border border-border">
                <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{asset}</div>
                <div className={`text-lg font-semibold mt-1 ${delta >= 0 ? 'text-accent' : 'text-destructive'}`}>
                  {fmtUSD(delta)}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {lastResult?.created?.length > 0 && (
        <Section title="Last Rebalance Result" subtitle="Transfers just created — review in the Transfers tab to execute">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 px-2">Transfer ID</th>
                  <th className="text-left py-2 px-2">Asset</th>
                  <th className="text-left py-2 px-2">Action</th>
                  <th className="text-right py-2 px-2">USD</th>
                </tr>
              </thead>
              <tbody>
                {lastResult.created.map(t => (
                  <tr key={t.transfer_id} className="border-b border-border">
                    <td className="py-2 px-2 text-foreground">{t.transfer_id}</td>
                    <td className="py-2 px-2 text-foreground font-semibold">{t.asset}</td>
                    <td className="py-2 px-2 text-muted-foreground">{t.action}</td>
                    <td className="py-2 px-2 text-right text-foreground">{fmtUSD(t.target_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}