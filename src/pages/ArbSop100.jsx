import React from 'react';
import Section from '@/components/arb/Section';
import SopTradeTicket from '@/components/arb/SopTradeTicket';
import { ClipboardCheck, Shield, Zap, AlertOctagon, Target, Ban } from 'lucide-react';

const capitalTemplate = [
  { label: 'Spot budget', value: '$35' },
  { label: 'Perp collateral', value: '$25' },
  { label: 'Execution buffer', value: '$10' },
  { label: 'Untouched reserve', value: '$30' },
  { label: 'Live trade size', value: '$15–$20 notional to start' },
];

const preTrade = [
  {
    heading: 'Market',
    text: 'Spot and perp books liquid at your size; spread not abnormally wide; funding estimate visible; next funding time known; no major exchange/API issues.',
  },
  {
    heading: 'Risk',
    text: 'One position only; no existing hedge mismatch; capital still inside limits; reserve untouched.',
  },
  {
    heading: 'Cost filter',
    text: 'Expected edge must exceed 2× estimated round-trip cost (fees + slippage).',
  },
];

const entrySteps = [
  { n: 1, title: 'Snapshot', text: 'Record spot bid/ask, perp bid/ask, funding estimate, timestamp.' },
  { n: 2, title: 'Perp first', text: 'Place post-only limit sell/short on BTC perp.' },
  { n: 3, title: 'Spot second', text: 'Place post-only limit buy on BTC spot for the same notional equivalent.' },
  { n: 4, title: 'Watch fills', text: 'Allow clean or small partial fills only.' },
  { n: 5, title: 'Resolve mismatch', text: 'Adjust once. If hedge cannot complete quickly, reduce exposure.' },
];

const fillExit = [
  { label: 'Acceptable', tone: 'accent', text: 'Maker fill on both legs, or small partial fill that can be completed quickly.' },
  { label: 'Unacceptable', tone: 'destructive', text: 'Repeated taker chasing, widening imbalance, waiting and hoping.' },
  { label: 'Planned exit', tone: 'primary', text: 'Funding edge weakens, basis compresses, objective achieved, or trade becomes operationally annoying.' },
  { label: 'Emergency exception', tone: 'warn', text: 'Use taker only to repair a broken hedge, not because you are impatient.' },
];

const hardRules = [
  'Max one open trade',
  'Max 3 live trades per day',
  'Max $25 notional per trade',
  'No full-account deployment',
  'No adding to losing hedge',
  'No second asset',
  'No cross-exchange arb',
  'No market orders unless hedge repair',
];

const toneClass = {
  accent: 'border-accent/30 bg-accent/5 text-accent',
  destructive: 'border-destructive/30 bg-destructive/5 text-destructive',
  primary: 'border-primary/30 bg-primary/5 text-primary',
  warn: 'border-chart-4/30 bg-chart-4/5 text-chart-4',
};

export default function ArbSop100() {
  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1100px] mx-auto space-y-6">
      <header className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <ClipboardCheck className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">One-Page SOP — $100 BTC Spot/Perp Carry</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tiny, delta-neutral, maker-first execution to validate fill quality, fee control, hedge discipline, and net PnL after all costs.
          </p>
        </div>
      </header>

      <Section title="Scope" subtitle="Hard perimeter for this SOP">
        <div className="flex flex-wrap gap-2">
          {[
            'One exchange only',
            'BTC only',
            'One open position max',
            '$15–$25 notional per trade',
            'No cross-exchange transfers',
            'No high leverage',
          ].map(s => (
            <span key={s} className="text-xs font-mono px-3 py-1.5 rounded-md border border-border bg-secondary/40 text-foreground">
              {s}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Capital Template" subtitle="$100 total book — fixed allocation">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {capitalTemplate.map(c => (
            <div key={c.label} className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{c.label}</div>
              <div className="text-lg font-bold text-foreground mt-1">{c.value}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Pre-Trade Checklist" subtitle="Clear all three before sending any order">
        <div className="space-y-3">
          {preTrade.map(p => (
            <div key={p.heading} className="flex gap-3 p-3 rounded-lg border border-border bg-secondary/20">
              <Shield className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">{p.heading}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{p.text}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Entry SOP" subtitle="Strict order of operations">
        <ol className="space-y-2">
          {entrySteps.map(s => (
            <li key={s.n} className="flex gap-3 p-3 rounded-lg border border-border bg-secondary/20">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-mono font-bold flex items-center justify-center">
                {s.n}
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">{s.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Fill & Exit Rules">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {fillExit.map(r => (
            <div key={r.label} className={`rounded-lg border p-3 ${toneClass[r.tone]}`}>
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">{r.label}</span>
              </div>
              <p className="text-xs mt-1.5 leading-relaxed opacity-90">{r.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Hard Rules" subtitle="Non-negotiable — breaking one closes the SOP">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {hardRules.map(r => (
            <div key={r} className="flex items-center gap-2 p-2.5 rounded-md border border-destructive/20 bg-destructive/5">
              <Ban className="w-3.5 h-3.5 text-destructive shrink-0" />
              <span className="text-xs font-mono text-foreground">{r}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Trade Ticket"
        subtitle="Fill in before entry · auto-validates the 2× cost rule and notional limits"
      >
        <SopTradeTicket />
      </Section>

      <div className="flex items-start gap-2 p-3 rounded-lg border border-chart-4/30 bg-chart-4/5 text-xs text-chart-4 font-mono">
        <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5" />
        <span>Purpose of this SOP is discipline, not PnL. Nail the process at $100 before scaling.</span>
      </div>
    </div>
  );
}