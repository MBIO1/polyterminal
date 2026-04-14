import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';

const Field = ({ label, value, onChange, min, max, step = 1, unit = '', description }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <span className="text-xs font-mono font-bold text-foreground">{value}{unit}</span>
    </div>
    <Slider
      value={[value]}
      onValueChange={([v]) => onChange(v)}
      min={min}
      max={max}
      step={step}
      className="py-1"
    />
    {description && <p className="text-[10px] text-muted-foreground/60">{description}</p>}
  </div>
);

export default function ConfigPanel({ config, onUpdate }) {
  if (!config) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        ⚙️ Bot Parameters
      </h3>

      <div className="space-y-4">
        <Field
          label="Edge Threshold"
          value={config.edge_threshold || 5}
          onChange={(v) => onUpdate({ edge_threshold: v })}
          min={1} max={20} step={0.5} unit="%"
          description="Min edge required to execute trade"
        />
        <Field
          label="Lag Threshold"
          value={config.lag_threshold || 3}
          onChange={(v) => onUpdate({ lag_threshold: v })}
          min={1} max={15} step={0.5} unit="pp"
          description="Min Polymarket vs CEX lag (percentage points)"
        />
        <Field
          label="Confidence Threshold"
          value={config.confidence_threshold || 85}
          onChange={(v) => onUpdate({ confidence_threshold: v })}
          min={50} max={99} unit="%"
          description="Min confidence score to execute"
        />
        <Field
          label="Max Position Size"
          value={config.max_position_pct || 8}
          onChange={(v) => onUpdate({ max_position_pct: v })}
          min={1} max={20} unit="%"
          description="Max % of portfolio per trade"
        />
        <Field
          label="Kelly Fraction"
          value={config.kelly_fraction || 0.5}
          onChange={(v) => onUpdate({ kelly_fraction: v })}
          min={0.1} max={1} step={0.1}
          description={`${((config.kelly_fraction || 0.5) * 100).toFixed(0)}% Kelly (0.5 = half-Kelly)`}
        />

        <Separator className="bg-border/50" />

        <Field
          label="Daily Halt Drawdown"
          value={config.daily_drawdown_halt || 20}
          onChange={(v) => onUpdate({ daily_drawdown_halt: v })}
          min={5} max={50} unit="%"
          description="Halt trading if daily loss exceeds this"
        />
        <Field
          label="Kill Switch Drawdown"
          value={config.total_drawdown_kill || 40}
          onChange={(v) => onUpdate({ total_drawdown_kill: v })}
          min={10} max={80} unit="%"
          description="Kill bot permanently if total DD exceeds"
        />
        <Field
          label="Min Liquidity"
          value={config.min_liquidity || 50000}
          onChange={(v) => onUpdate({ min_liquidity: v })}
          min={10000} max={500000} step={5000}
          unit=" USDC"
          description="Only trade markets with ›$50K liquidity"
        />

        <Separator className="bg-border/50" />

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Starting Balance (USDC)</Label>
          <Input
            type="number"
            value={config.starting_balance || 1000}
            onChange={(e) => onUpdate({ starting_balance: Number(e.target.value) })}
            className="font-mono bg-secondary border-border text-sm"
          />
        </div>

        <Separator className="bg-border/50" />

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Telegram Alerts</Label>
          <Input
            placeholder="Bot Token"
            value={config.telegram_bot_token || ''}
            onChange={(e) => onUpdate({ telegram_bot_token: e.target.value })}
            className="font-mono bg-secondary border-border text-xs"
          />
          <Input
            placeholder="Chat ID"
            value={config.telegram_chat_id || ''}
            onChange={(e) => onUpdate({ telegram_chat_id: e.target.value })}
            className="font-mono bg-secondary border-border text-xs"
          />
        </div>
      </div>
    </div>
  );
}