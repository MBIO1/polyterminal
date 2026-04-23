import React, { useState } from 'react';
import { X, Play, FlaskConical, Loader2, CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { fmtUSD } from '@/lib/arbMath';

function GateRow({ label, pass, detail }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/50 last:border-0">
      <div className="mt-0.5 flex-shrink-0">
        {pass
          ? <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
          : <XCircle className="w-3.5 h-3.5 text-destructive" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-mono text-foreground">{label}</span>
        {detail && <p className="text-[10px] font-mono text-muted-foreground mt-0.5 break-all">{detail}</p>}
      </div>
    </div>
  );
}

export default function SignalDetailDrawer({ signal, onClose, onExecuted }) {
  const [dryRunResult, setDryRunResult] = useState(null);
  const [executing, setExecuting] = useState(false);
  const [dryRunning, setDryRunning] = useState(false);

  if (!signal) return null;

  const edge = Number(signal.net_edge_bps || 0);
  const raw = Number(signal.raw_spread_bps || 0);
  const fill = Number(signal.fillable_size_usd || 0);
  const feesBps = 4 * 2; // 4 legs × 2 bps
  const estProfit = ((edge - feesBps) / 10000) * fill;

  const isPending = signal.status === 'detected' || signal.status === 'alerted';
  const canExecute = true; // allow force on any signal for monitoring purposes

  const runDryRun = async () => {
    setDryRunning(true);
    setDryRunResult(null);
    try {
      const res = await base44.functions.invoke('executeSignals', {
        signal_id: signal.id,
        dry_run: true,
      });
      setDryRunResult(res?.data);
    } catch (e) {
      toast.error('Dry run failed', { description: e.message });
    } finally {
      setDryRunning(false);
    }
  };

  const runExecute = async () => {
    setExecuting(true);
    try {
      const res = await base44.functions.invoke('executeSignals', {
        signal_id: signal.id,
        dry_run: false,
      });
      const result = res?.data?.results?.[0];
      if (result?.decision === 'executed') {
        toast.success(`${signal.pair} executed`, {
          description: `Trade ${result.trade_id} · PnL ${result.net_pnl_usd >= 0 ? '+' : ''}$${Number(result.net_pnl_usd).toFixed(2)}`,
        });
        onExecuted?.();
        onClose();
      } else if (result?.decision === 'rejected') {
        toast.error(`${signal.pair} rejected`, { description: (result.reasons || []).join(', ') });
        setDryRunResult(res?.data);
      } else {
        toast.info(`Result: ${result?.decision || 'unknown'}`);
        setDryRunResult(res?.data);
      }
    } catch (e) {
      toast.error('Execution failed', { description: e.message });
    } finally {
      setExecuting(false);
    }
  };

  // Parse gate info from dry run result or rejection reason
  const drResult = dryRunResult?.results?.[0];
  const gateReasons = drResult?.reasons || (signal.rejection_reason ? signal.rejection_reason.split(',') : []);

  // Heuristic gate analysis from signal data
  const gates = [
    {
      label: 'Edge above min threshold',
      pass: edge >= 3,
      detail: `${edge.toFixed(2)} bps net edge`,
    },
    {
      label: 'Sufficient fillable liquidity',
      pass: fill >= 500,
      detail: `$${fill.toLocaleString()} fillable (min $500)`,
    },
    {
      label: 'Multi-exchange confirmation',
      pass: Number(signal.confirmed_exchanges || 0) >= 1,
      detail: `${signal.confirmed_exchanges || 0} venues confirmed`,
    },
    {
      label: 'Signal freshness (age < 5min)',
      pass: Date.now() - new Date(signal.received_time || signal.created_date).getTime() < 300_000,
      detail: `${Math.round((Date.now() - new Date(signal.received_time || signal.created_date).getTime()) / 1000)}s old`,
    },
    {
      label: 'Profitable after fees',
      pass: edge > feesBps,
      detail: `${edge.toFixed(1)} bps edge vs ${feesBps} bps fees → net ${(edge - feesBps).toFixed(1)} bps`,
    },
  ];

  const statusColor = {
    detected: 'text-chart-4 bg-chart-4/10',
    alerted: 'text-primary bg-primary/10',
    executed: 'text-accent bg-accent/10',
    rejected: 'text-destructive bg-destructive/10',
    expired: 'text-muted-foreground bg-muted/20',
  }[signal.status] || 'text-muted-foreground bg-muted/20';

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/60" onClick={onClose} />

      {/* Drawer */}
      <div className="w-full max-w-md bg-card border-l border-border flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <div>
            <h2 className="text-sm font-bold text-foreground">{signal.pair}</h2>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded mt-1 inline-block ${statusColor}`}>
              {signal.status?.toUpperCase()}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Signal metrics */}
        <div className="px-5 py-4 border-b border-border space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Signal Metrics</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Raw Spread', value: `${raw.toFixed(2)} bps` },
              { label: 'Net Edge', value: `${edge.toFixed(2)} bps`, highlight: edge >= 20 ? 'positive' : edge >= 10 ? 'warn' : 'neutral' },
              { label: 'Buy Price', value: `$${Number(signal.buy_price || 0).toFixed(4)}` },
              { label: 'Sell Price', value: `$${Number(signal.sell_price || 0).toFixed(4)}` },
              { label: 'Fillable', value: fmtUSD(fill, 0) },
              { label: 'Est. Profit', value: estProfit > 0 ? `+$${estProfit.toFixed(2)}` : `$${estProfit.toFixed(2)}`, highlight: estProfit > 0 ? 'positive' : 'negative' },
              { label: 'Buy Venue', value: signal.buy_exchange || '—' },
              { label: 'Sell Venue', value: signal.sell_exchange || '—' },
              { label: 'Signal Age', value: `${Number(signal.signal_age_ms || 0)}ms` },
              { label: 'Confirmed', value: `${signal.confirmed_exchanges || 0}/4` },
            ].map(({ label, value, highlight }) => (
              <div key={label} className="bg-secondary/30 rounded-lg p-2">
                <p className="text-[10px] font-mono text-muted-foreground">{label}</p>
                <p className={`text-xs font-semibold font-mono mt-0.5 ${
                  highlight === 'positive' ? 'text-accent' :
                  highlight === 'negative' ? 'text-destructive' :
                  highlight === 'warn' ? 'text-chart-4' :
                  'text-foreground'
                }`}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Gate analysis */}
        <div className="px-5 py-4 border-b border-border space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Gate Analysis</h3>
          <div>
            {gates.map((g, i) => <GateRow key={i} label={g.label} pass={g.pass} detail={g.detail} />)}
          </div>
        </div>

        {/* Rejection reason if any */}
        {signal.rejection_reason && (
          <div className="px-5 py-3 border-b border-border">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-destructive">Rejection Reason</p>
                <p className="text-[10px] font-mono text-muted-foreground mt-0.5 break-all">{signal.rejection_reason}</p>
              </div>
            </div>
          </div>
        )}

        {/* Executed PnL if available */}
        {signal.status === 'executed' && signal.executed_pnl_usd != null && (
          <div className="px-5 py-3 border-b border-border">
            <div className={`flex items-start gap-2 p-3 rounded-lg border ${Number(signal.executed_pnl_usd) >= 0 ? 'bg-accent/10 border-accent/20' : 'bg-destructive/10 border-destructive/20'}`}>
              <Info className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${Number(signal.executed_pnl_usd) >= 0 ? 'text-accent' : 'text-destructive'}`} />
              <div>
                <p className={`text-xs font-semibold ${Number(signal.executed_pnl_usd) >= 0 ? 'text-accent' : 'text-destructive'}`}>
                  Executed PnL: {Number(signal.executed_pnl_usd) >= 0 ? '+' : ''}${Number(signal.executed_pnl_usd).toFixed(2)}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground">{Number(signal.executed_pnl_bps || 0).toFixed(2)} bps · {signal.win ? 'WIN' : 'LOSS'}</p>
              </div>
            </div>
          </div>
        )}

        {/* Dry run result */}
        {dryRunResult && (
          <div className="px-5 py-3 border-b border-border space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Executor Response</h3>
            <div className="bg-secondary/30 rounded-lg p-3">
              {drResult ? (
                <div className="space-y-1">
                  <p className="text-xs font-mono">
                    Decision: <span className={`font-bold ${drResult.decision === 'would_execute' ? 'text-accent' : drResult.decision === 'rejected' ? 'text-destructive' : 'text-foreground'}`}>
                      {drResult.decision}
                    </span>
                  </p>
                  {drResult.size_usd && <p className="text-xs font-mono text-muted-foreground">Size: ${drResult.size_usd.toLocaleString()}</p>}
                  {drResult.reasons?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {drResult.reasons.map((r, i) => (
                        <p key={i} className="text-[10px] font-mono text-destructive bg-destructive/10 px-2 py-1 rounded">{r}</p>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] font-mono text-muted-foreground mt-2">
                    Paper: {dryRunResult.paper_trading ? 'yes' : 'no'} · Expired: {dryRunResult.expired || 0}
                  </p>
                </div>
              ) : (
                <p className="text-xs font-mono text-muted-foreground">No result returned</p>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-5 py-4 space-y-2 mt-auto sticky bottom-0 bg-card border-t border-border">
          <button
            onClick={runDryRun}
            disabled={dryRunning || executing}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-secondary hover:bg-secondary/70 text-foreground text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {dryRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
            {dryRunning ? 'Running dry run…' : 'Dry Run (simulate gates)'}
          </button>
          <button
            onClick={runExecute}
            disabled={executing || dryRunning}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {executing ? 'Executing…' : 'Force Execute'}
          </button>
          <p className="text-[10px] font-mono text-muted-foreground text-center">
            Force execute bypasses TTL/status filters but respects all risk gates
          </p>
        </div>
      </div>
    </div>
  );
}