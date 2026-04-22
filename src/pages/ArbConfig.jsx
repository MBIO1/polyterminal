import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Section from '@/components/arb/Section';
import CapitalBuckets from '@/components/arb/CapitalBuckets';
import BreakevenPanel from '@/components/arb/BreakevenPanel';

const GROUPS = [
  {
    title: 'Capital & Allocation',
    fields: [
      { key: 'total_capital', label: 'Total Capital (USD)', step: 1000 },
      { key: 'reserve_pct', label: 'Reserve %', step: 0.01 },
      { key: 'spot_allocation_pct', label: 'Spot Allocation %', step: 0.01 },
      { key: 'perp_collateral_pct', label: 'Perp Collateral %', step: 0.01 },
      { key: 'execution_buffer_pct', label: 'Execution Buffer %', step: 0.01 },
    ],
  },
  {
    title: 'Risk Limits',
    fields: [
      { key: 'max_daily_drawdown_pct', label: 'Max Daily Drawdown %', step: 0.001 },
      { key: 'max_single_trade_loss_pct', label: 'Max Single Trade Loss %', step: 0.0001 },
      { key: 'max_net_delta_drift_pct', label: 'Max Net Delta Drift %', step: 0.0001 },
      { key: 'max_margin_utilization_pct', label: 'Max Margin Utilization %', step: 0.01 },
    ],
  },
  {
    title: 'Edge Thresholds',
    fields: [
      { key: 'btc_min_edge_bps', label: 'BTC Min Edge (bps)', step: 1 },
      { key: 'eth_min_edge_bps', label: 'ETH Min Edge (bps)', step: 1 },
      { key: 'stress_slippage_multiplier', label: 'Stress Slippage ×', step: 0.1 },
    ],
  },
  {
    title: 'Fee Assumptions',
    fields: [
      { key: 'spot_maker_fee', label: 'Spot Maker Fee', step: 0.0001 },
      { key: 'spot_taker_fee', label: 'Spot Taker Fee', step: 0.0001 },
      { key: 'perp_maker_fee', label: 'Perp Maker Fee', step: 0.0001 },
      { key: 'perp_taker_fee', label: 'Perp Taker Fee', step: 0.0001 },
      { key: 'taker_fee_bps_per_leg', label: 'Basis Arb Taker Fee (bps/leg)', step: 0.1 },
    ],
  },
  {
    title: 'Funding Capture Strategy',
    fields: [
      { key: 'funding_enabled', label: 'Funding Capture Enabled', step: 1, isSwitch: true },
      { key: 'funding_min_apr_bps', label: 'Min APR to Enter (bps)', step: 100 },
      { key: 'funding_exit_apr_bps', label: 'Exit APR Threshold (bps)', step: 100 },
      { key: 'funding_exit_on_flip', label: 'Exit on Sign Flip', step: 1, isSwitch: true },
      { key: 'funding_max_position_usd', label: 'Max Position Size (USD)', step: 50 },
    ],
  },
];

export default function ArbConfig() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ['arb-config'],
    queryFn: async () => (await base44.entities.ArbConfig.list('-created_date', 1))[0],
  });

  const [f, setF] = useState({});
  useEffect(() => { if (config) setF(config); }, [config]);

  const save = useMutation({
    mutationFn: async (data) => {
      if (config?.id) return base44.entities.ArbConfig.update(config.id, data);
      return base44.entities.ArbConfig.create(data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['arb-config'] }); toast.success('Config saved'); },
    onError: (e) => toast.error(e.message),
  });

  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  if (isLoading) return <div className="p-8 text-center text-muted-foreground font-mono text-sm">Loading…</div>;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1200px] mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Configuration</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">Strategy parameters and risk limits</p>
        </div>
        <Button onClick={() => save.mutate(f)} disabled={save.isPending}>
          <Save className="w-4 h-4 mr-2" />
          {save.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>

      <Section title="Capital Buckets" subtitle="Derived allocation preview">
        <CapitalBuckets config={f} />
      </Section>

      <Section
        title="Breakeven Analysis"
        subtitle="Minimum edge required before a basis-carry trade is profitable"
      >
        <BreakevenPanel config={f} />
      </Section>

      <Section title="Bot Controls">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { k: 'bot_running', label: 'Bot Running', sub: 'Allow automated execution' },
            { k: 'paper_trading', label: 'Paper Trading', sub: 'Simulate only, no real orders' },
            { k: 'kill_switch_active', label: 'Kill Switch', sub: 'Halt all trading immediately' },
          ].map(({ k, label, sub }) => (
            <div key={k} className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/30">
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{sub}</p>
              </div>
              <Switch checked={!!f[k]} onCheckedChange={(v) => set(k, v)} />
            </div>
          ))}
        </div>
      </Section>

      {GROUPS.map(g => (
        <Section key={g.title} title={g.title}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.fields.map(({ key, label, step, isSwitch }) => (
              <div key={key}>
                <Label className="text-xs font-mono text-muted-foreground">{label}</Label>
                {isSwitch ? (
                  <Switch checked={!!f[key]} onCheckedChange={(v) => set(key, v)} className="mt-1" />
                ) : (
                  <Input
                    type="number"
                    step={step}
                    value={f[key] ?? ''}
                    onChange={(e) => set(key, e.target.value === '' ? '' : Number(e.target.value))}
                    className="font-mono mt-1"
                  />
                )}
              </div>
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}