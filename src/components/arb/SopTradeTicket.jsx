import React, { useMemo, useState } from 'react';
import { Check, X, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const FIELDS = [
  { key: 'date_time', label: 'Date / Time', type: 'datetime-local' },
  { key: 'exchange', label: 'Exchange' },
  { key: 'symbol', label: 'Symbol', placeholder: 'BTC-USDT' },
  { key: 'strategy', label: 'Strategy', placeholder: 'Same-venue Spot/Perp Carry' },
  { key: 'spot_side', label: 'Spot side', placeholder: 'Long' },
  { key: 'perp_side', label: 'Perp side', placeholder: 'Short' },
  { key: 'notional', label: 'Planned notional ($)', type: 'number', numeric: true },
  { key: 'spot_limit_px', label: 'Spot limit price', type: 'number', numeric: true },
  { key: 'perp_limit_px', label: 'Perp limit price', type: 'number', numeric: true },
  { key: 'funding_est', label: 'Funding estimate ($)', type: 'number', numeric: true },
  { key: 'fee_est', label: 'Round-trip fee est. ($)', type: 'number', numeric: true },
  { key: 'slippage_est', label: 'Slippage est. ($)', type: 'number', numeric: true },
  { key: 'edge_est', label: 'Expected edge ($)', type: 'number', numeric: true },
];

export default function SopTradeTicket() {
  const [form, setForm] = useState({});

  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const num = (k) => {
    const n = parseFloat(form[k]);
    return Number.isFinite(n) ? n : null;
  };

  const { roundTripCost, passes2x, edge } = useMemo(() => {
    const fee = num('fee_est') || 0;
    const slip = num('slippage_est') || 0;
    const cost = fee + slip;
    const edgeVal = num('edge_est');
    const passes = edgeVal != null && cost > 0 && edgeVal >= cost * 2;
    return { roundTripCost: cost, passes2x: passes, edge: edgeVal };
  }, [form]);

  const notional = num('notional');
  const notionalOk = notional != null && notional >= 15 && notional <= 25;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {FIELDS.map(f => (
          <div key={f.key} className="space-y-1">
            <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {f.label}
            </Label>
            <Input
              type={f.type || 'text'}
              value={form[f.key] || ''}
              onChange={e => setField(f.key, e.target.value)}
              placeholder={f.placeholder || ''}
              className="font-mono text-sm h-9"
              step={f.numeric ? 'any' : undefined}
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
        <CheckTile
          label="Notional $15–$25"
          ok={notionalOk}
          detail={notional != null ? `$${notional.toFixed(2)}` : 'enter notional'}
        />
        <CheckTile
          label="Round-trip cost"
          ok={roundTripCost > 0}
          detail={roundTripCost > 0 ? `$${roundTripCost.toFixed(2)} (fees + slip)` : 'enter fee + slippage'}
          neutral
        />
        <CheckTile
          label="Passes 2× cost rule"
          ok={passes2x}
          detail={
            edge == null
              ? 'enter expected edge'
              : roundTripCost === 0
              ? 'enter costs'
              : `edge $${edge.toFixed(2)} vs 2× cost $${(roundTripCost * 2).toFixed(2)}`
          }
        />
      </div>

      <div className="text-[11px] font-mono text-muted-foreground leading-relaxed pt-2 border-t border-border">
        Ticket is a local pre-trade check — nothing is persisted. When all three tiles are green, proceed to log the actual trade in <span className="text-primary">Trades</span>.
      </div>
    </div>
  );
}

function CheckTile({ label, ok, detail, neutral }) {
  const Icon = neutral ? AlertTriangle : ok ? Check : X;
  const tone = neutral
    ? 'border-chart-4/40 bg-chart-4/10 text-chart-4'
    : ok
    ? 'border-accent/40 bg-accent/10 text-accent'
    : 'border-destructive/40 bg-destructive/10 text-destructive';
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <p className="text-[11px] font-mono mt-1 opacity-90">{detail}</p>
    </div>
  );
}