import React from 'react';
import { TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';

// Shows the true breakeven threshold for a basis-carry trade:
//   required_bps = (spot_entry + perp_entry + spot_exit + perp_exit) × 10000 + slippage buffer
// Then compares it against the user's configured min-edge gates.
export default function BreakevenPanel({ config = {} }) {
  const spotTaker = Number(config.spot_taker_fee || 0);
  const perpTaker = Number(config.perp_taker_fee || 0);
  const stressMult = Number(config.stress_slippage_multiplier || 1);

  // Round-trip fees in bps: 2 × spot_taker + 2 × perp_taker, times 10000
  const feesBps = (2 * spotTaker + 2 * perpTaker) * 10000;
  // Slippage buffer: assume ~1bp per leg as baseline × stress multiplier
  const slippageBps = 4 * 1 * stressMult;
  const requiredBps = feesBps + slippageBps;

  const btcGate = Number(config.btc_min_edge_bps || 0);
  const ethGate = Number(config.eth_min_edge_bps || 0);

  const assess = (gate) => {
    if (gate < feesBps) return { tone: 'destructive', label: 'BELOW FEES', icon: AlertTriangle };
    if (gate < requiredBps) return { tone: 'chart-4', label: 'TIGHT', icon: AlertTriangle };
    return { tone: 'accent', label: 'SAFE', icon: CheckCircle2 };
  };

  const btc = assess(btcGate);
  const eth = assess(ethGate);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Row
          label="Round-trip fees"
          value={`${feesBps.toFixed(1)} bps`}
          sub={`2×spot(${(spotTaker * 10000).toFixed(1)}) + 2×perp(${(perpTaker * 10000).toFixed(1)})`}
          tone="muted"
        />
        <Row
          label="Slippage buffer"
          value={`${slippageBps.toFixed(1)} bps`}
          sub={`4 legs × 1bp × ${stressMult}× stress`}
          tone="muted"
        />
        <Row
          label="Required edge"
          value={`${requiredBps.toFixed(1)} bps`}
          sub="Minimum viable before profit"
          tone="primary"
          emphasis
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <GateRow asset="BTC" gate={btcGate} required={requiredBps} fees={feesBps} assess={btc} />
        <GateRow asset="ETH" gate={ethGate} required={requiredBps} fees={feesBps} assess={eth} />
      </div>

      <div className="rounded-lg border border-border bg-secondary/30 p-3">
        <p className="text-[11px] font-mono text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Formula:</strong> every carry opens both legs (entry) and closes both (exit) = 4 taker fills.
          Profit starts only once the basis spread exceeds the sum of all 4 fees plus expected slippage.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, sub, tone = 'muted', emphasis = false }) {
  const toneClass = {
    muted: 'text-muted-foreground',
    primary: 'text-primary',
    accent: 'text-accent',
  }[tone] || 'text-muted-foreground';

  return (
    <div className={`rounded-lg border border-border bg-secondary/30 p-3 ${emphasis ? 'ring-1 ring-primary/30' : ''}`}>
      <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-mono font-semibold mt-1 ${toneClass}`}>{value}</p>
      {sub && <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function GateRow({ asset, gate, required, fees, assess }) {
  const Icon = assess.icon;
  const colorMap = {
    destructive: 'text-destructive border-destructive/40 bg-destructive/5',
    'chart-4': 'text-chart-4 border-chart-4/40 bg-chart-4/5',
    accent: 'text-accent border-accent/40 bg-accent/5',
  };
  const cls = colorMap[assess.tone];
  const margin = gate - required;

  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          <span className="text-sm font-semibold text-foreground">{asset} gate</span>
        </div>
        <span className="flex items-center gap-1 text-[10px] font-mono font-bold uppercase">
          <Icon className="w-3 h-3" />
          {assess.label}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-mono">
        <div>
          <p className="text-muted-foreground">Gate</p>
          <p className="text-foreground font-semibold">{gate} bps</p>
        </div>
        <div>
          <p className="text-muted-foreground">Fees floor</p>
          <p className="text-foreground">{fees.toFixed(1)} bps</p>
        </div>
        <div>
          <p className="text-muted-foreground">Margin</p>
          <p className={margin >= 0 ? 'text-accent' : 'text-destructive'}>
            {margin >= 0 ? '+' : ''}{margin.toFixed(1)} bps
          </p>
        </div>
      </div>
    </div>
  );
}