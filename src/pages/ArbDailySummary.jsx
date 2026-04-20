import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import Section from '@/components/arb/Section';
import EmptyState from '@/components/arb/EmptyState';
import { fmtUSD, computeNetPnl } from '@/lib/arbMath';

export default function ArbDailySummary() {
  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['arb-trades-summary'],
    queryFn: () => base44.entities.ArbTrade.list('-trade_date', 1000),
  });
  const { data: transfers = [] } = useQuery({
    queryKey: ['arb-transfers-summary'],
    queryFn: () => base44.entities.ArbTransfer.list('-transfer_date', 1000),
  });

  // Aggregate by date
  const byDate = {};
  for (const t of trades) {
    const d = t.trade_date;
    if (!d) continue;
    if (!byDate[d]) byDate[d] = { date: d, trades: 0, wins: 0, losses: 0, pnl: 0, fees: 0, funding: 0, slippage: 0 };
    const pnl = t.net_pnl ?? computeNetPnl(t);
    byDate[d].trades += 1;
    byDate[d].pnl += pnl;
    byDate[d].fees += Number(t.total_realized_fees || 0);
    byDate[d].funding += Number(t.realized_funding || 0);
    byDate[d].slippage += Number(t.realized_slippage || 0);
    if (t.status === 'Closed') {
      if (pnl > 0) byDate[d].wins += 1;
      else if (pnl < 0) byDate[d].losses += 1;
    }
  }
  for (const t of transfers) {
    const d = t.transfer_date;
    if (!d || !byDate[d]) byDate[d] = byDate[d] || { date: d, trades: 0, wins: 0, losses: 0, pnl: 0, fees: 0, funding: 0, slippage: 0, transfers_net: 0 };
    byDate[d].transfers_net = (byDate[d].transfers_net || 0) + Number(t.rebalance_impact_usd || 0);
  }

  const rows = Object.values(byDate).sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Daily Summary</h1>
        <p className="text-sm text-muted-foreground mt-1 font-mono">Aggregated PnL, fees, funding, and rebalance impact by day</p>
      </div>

      <Section title="Daily Aggregates">
        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground font-mono text-sm">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No activity recorded" subtitle="Log trades and transfers to see daily aggregates." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono whitespace-nowrap">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left py-2 px-2 font-medium">Date</th>
                  <th className="text-right font-medium">Trades</th>
                  <th className="text-right font-medium">Wins</th>
                  <th className="text-right font-medium">Losses</th>
                  <th className="text-right font-medium">Hit Rate</th>
                  <th className="text-right font-medium">Net PnL</th>
                  <th className="text-right font-medium">Fees</th>
                  <th className="text-right font-medium">Funding</th>
                  <th className="text-right font-medium">Slippage</th>
                  <th className="text-right font-medium">Transfers Impact</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const closed = r.wins + r.losses;
                  const hit = closed > 0 ? ((r.wins / closed) * 100).toFixed(1) + '%' : '—';
                  return (
                    <tr key={r.date} className="border-b border-border/30 hover:bg-secondary/40">
                      <td className="py-2 px-2 font-semibold text-foreground">{r.date}</td>
                      <td className="text-right">{r.trades}</td>
                      <td className="text-right text-accent">{r.wins}</td>
                      <td className="text-right text-destructive">{r.losses}</td>
                      <td className="text-right">{hit}</td>
                      <td className={`text-right font-semibold ${r.pnl >= 0 ? 'text-accent' : 'text-destructive'}`}>{fmtUSD(r.pnl)}</td>
                      <td className="text-right text-chart-4">{fmtUSD(r.fees)}</td>
                      <td className={`text-right ${r.funding >= 0 ? 'text-accent' : 'text-destructive'}`}>{fmtUSD(r.funding)}</td>
                      <td className="text-right text-chart-4">{fmtUSD(r.slippage)}</td>
                      <td className={`text-right ${(r.transfers_net || 0) >= 0 ? 'text-accent' : 'text-destructive'}`}>{fmtUSD(r.transfers_net || 0)}</td>
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