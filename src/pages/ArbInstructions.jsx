import React from 'react';
import Section from '@/components/arb/Section';
import { BookOpen } from 'lucide-react';

const instructions = [
  'Edit core capital and fee assumptions in Config.',
  'Enter every planned or completed trade in Trades.',
  'Use separate Spot Exchange and Perp Exchange for each trade.',
  'Record inter-exchange transfers, funding payments, and rebalances in Transfers.',
  'Keep Live Positions updated for open inventory and margin snapshots.',
  'Log every operational issue in Exceptions.',
  'Dashboard and Daily Summary are auto-computed from trade / transfer / exception data.',
  'For cross-venue trades, capture both raw spread and normalized spread in bps.',
  'Fill realized fees and funding explicitly; do not trust estimates after execution.',
  'Reconcile end-of-day balances against exchange statements.',
  'Minimal controls remain mandatory. Removing them is how neutral books become directional losses.',
];

const conventions = [
  { color: 'bg-accent', label: 'Positive PnL / success' },
  { color: 'bg-destructive', label: 'Negative PnL / critical / open issues' },
  { color: 'bg-chart-4', label: 'Warning / pending / medium severity' },
  { color: 'bg-primary', label: 'Informational / identifiers' },
];

export default function ArbInstructions() {
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1000px] mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Operating Playbook</h1>
          <p className="text-sm text-muted-foreground mt-0.5 font-mono">Version 2 — Cross-venue crypto arbitrage workflow</p>
        </div>
      </div>

      <Section title="Workflow">
        <ol className="space-y-2.5 text-sm">
          {instructions.map((txt, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-secondary text-foreground text-xs font-mono font-bold flex items-center justify-center">{i + 1}</span>
              <span className="text-foreground/90 leading-relaxed">{txt}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Color Conventions">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {conventions.map(c => (
            <div key={c.label} className="flex items-center gap-3 p-2 rounded-lg border border-border">
              <span className={`w-3 h-3 rounded-full ${c.color}`} />
              <span className="text-xs font-mono text-foreground">{c.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Recommended Cadence">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p><span className="text-foreground font-medium">Pre-market:</span> Review Config, confirm capital buckets, scan open positions and margin headroom.</p>
          <p><span className="text-foreground font-medium">Intraday:</span> Log every fill immediately. Record transfers as they initiate, not when they settle.</p>
          <p><span className="text-foreground font-medium">End of day:</span> Reconcile balances, close open positions that carried intended edge, log exceptions.</p>
          <p><span className="text-foreground font-medium">Weekly:</span> Review Daily Summary trend, recalibrate min-edge thresholds, audit fee assumptions against actual exchange reports.</p>
        </div>
      </Section>
    </div>
  );
}