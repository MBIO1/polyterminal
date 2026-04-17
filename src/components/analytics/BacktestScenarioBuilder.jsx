import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Play, CheckCircle2 } from 'lucide-react';

const CONTRACT_TYPES = ['5min_up', '5min_down', '15min_up', '15min_down'];
const SCENARIO_COLORS = [
  'hsl(199 89% 48%)',
  'hsl(142 71% 45%)',
  'hsl(45 93% 58%)',
  'hsl(280 65% 60%)',
];

const DEFAULT_SCENARIO = {
  lag: 3,
  edge: 5,
  conf: 85,
  kelly: 0.5,
  capital: 1000,
  contractType: '5min_up',
};

function ScenarioCard({ scenario, index, color, onChange, onRemove, canRemove }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-xs font-mono font-bold text-foreground">Scenario {index + 1}</span>
        </div>
        {canRemove && (
          <button onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Contract Type</Label>
          <Select value={scenario.contractType} onValueChange={v => onChange({ contractType: v })}>
            <SelectTrigger className="h-7 text-xs bg-secondary border-border font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTRACT_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Initial Capital ($)</Label>
          <Select value={String(scenario.capital)} onValueChange={v => onChange({ capital: Number(v) })}>
            <SelectTrigger className="h-7 text-xs bg-secondary border-border font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[500, 1000, 2500, 5000, 10000].map(c => (
                <SelectItem key={c} value={String(c)} className="text-xs">${c.toLocaleString()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {[
        { key: 'lag', label: 'Lag Threshold', min: 1, max: 10, step: 0.5, unit: 'pp' },
        { key: 'edge', label: 'Edge Threshold', min: 1, max: 20, step: 0.5, unit: '%' },
        { key: 'conf', label: 'Confidence', min: 50, max: 99, step: 1, unit: '%' },
        { key: 'kelly', label: 'Kelly Fraction', min: 0.1, max: 1, step: 0.1, unit: 'x' },
      ].map(({ key, label, min, max, step, unit }) => (
        <div key={key} className="space-y-1">
          <div className="flex justify-between">
            <Label className="text-[10px] text-muted-foreground">{label}</Label>
            <span className="text-[10px] font-mono font-bold text-foreground">{scenario[key]}{unit}</span>
          </div>
          <Slider
            value={[scenario[key]]}
            onValueChange={([v]) => onChange({ [key]: v })}
            min={min} max={max} step={step}
            className="py-0.5"
          />
        </div>
      ))}
    </div>
  );
}

function KpiGrid({ result, color }) {
  if (!result) return (
    <div className="rounded-lg border border-border bg-secondary/10 p-4 flex items-center justify-center h-32">
      <span className="text-xs text-muted-foreground font-mono">Not run yet</span>
    </div>
  );

  const kpis = [
    { label: 'Trades', value: result.tradeCount },
    { label: 'Win Rate', value: `${result.winRate.toFixed(1)}%`, pos: result.winRate >= 50 },
    { label: 'Total P&L', value: `${result.totalPnl >= 0 ? '+' : ''}$${result.totalPnl.toFixed(2)}`, pos: result.totalPnl >= 0 },
    { label: 'Max DD', value: `${result.maxDrawdown.toFixed(1)}%`, pos: result.maxDrawdown < 20 },
    { label: 'Profit Factor', value: result.profitFactor.toFixed(2), pos: result.profitFactor >= 1.2 },
    { label: 'Final Balance', value: `$${result.finalBalance?.toFixed(0) || '—'}`, pos: result.totalPnl >= 0 },
  ];

  return (
    <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: color + '40' }}>
      <div className="flex items-center gap-1.5 mb-3">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] font-mono text-muted-foreground">Results</span>
        {result.dataSource && <span className="text-[9px] text-muted-foreground/60 ml-auto">{result.dataSource}</span>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {kpis.map(({ label, value, pos }) => (
          <div key={label} className="text-center">
            <p className="text-[9px] text-muted-foreground">{label}</p>
            <p className={`text-xs font-mono font-bold ${pos !== undefined ? (pos ? 'text-accent' : 'text-destructive') : 'text-foreground'}`}>{value}</p>
          </div>
        ))}
      </div>
      {result.recommendedThresholds && (
        <div className="mt-2 rounded bg-secondary/40 px-2 py-1 text-[10px] font-mono text-muted-foreground">
          Grid opt: Lag {result.recommendedThresholds.lag}pp · Edge {result.recommendedThresholds.edge}% · Conf {result.recommendedThresholds.confidence}%
        </div>
      )}
    </div>
  );
}

export default function BacktestScenarioBuilder({ onSetLiveParams }) {
  const [scenarios, setScenarios] = useState([{ ...DEFAULT_SCENARIO }]);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [bestIdx, setBestIdx] = useState(null);
  const [applyingIdx, setApplyingIdx] = useState(null);

  const addScenario = () => {
    if (scenarios.length >= 4) return;
    setScenarios(prev => [...prev, { ...DEFAULT_SCENARIO, contractType: CONTRACT_TYPES[prev.length % CONTRACT_TYPES.length] }]);
  };

  const updateScenario = (idx, patch) => {
    setScenarios(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  const removeScenario = (idx) => {
    setScenarios(prev => prev.filter((_, i) => i !== idx));
    setResults(prev => prev.filter((_, i) => i !== idx));
  };

  const runAll = async () => {
    setRunning(true);
    setResults([]);
    setBestIdx(null);

    // Lazy import to avoid loading on mount
    const { runBacktest } = await import('@/lib/backtester');

    const allResults = [];
    for (let i = 0; i < scenarios.length; i++) {
      const s = scenarios[i];
      setProgress(`Running Scenario ${i + 1}/${scenarios.length}…`);
      try {
        const res = await runBacktest((msg, pct) => setProgress(`S${i + 1}: ${msg} (${pct}%)`), {
          lagThresh: s.lag,
          edgeThresh: s.edge,
          confThresh: s.conf,
          kellyFrac: s.kelly,
          capital: s.capital,
          contractType: s.contractType,
        });
        allResults.push(res);
      } catch {
        allResults.push(null);
      }
    }

    setResults(allResults);

    // Find best by profit factor * win rate / maxDD
    const scored = allResults.map((r, i) => ({
      i,
      score: r ? (r.profitFactor * r.winRate) / Math.max(1, r.maxDrawdown) : -1,
    }));
    const best = scored.reduce((a, b) => a.score > b.score ? a : b);
    if (best.score > 0) setBestIdx(best.i);

    setRunning(false);
    setProgress('');
  };

  const handleSetLive = async (idx) => {
    const s = scenarios[idx];
    const r = results[idx];
    setApplyingIdx(idx);
    await onSetLiveParams({
      lag_threshold: s.lag,
      edge_threshold: s.edge,
      confidence_threshold: s.conf,
      kelly_fraction: s.kelly,
      bot_running: true,
    }, r);
    setApplyingIdx(null);
  };

  const equityCurves = results
    .map((r, i) => r?.priceSeries ? { data: r.priceSeries, color: SCENARIO_COLORS[i], label: `S${i + 1}` } : null)
    .filter(Boolean);

  return (
    <div className="space-y-5">
      {/* Scenario cards */}
      <div className={`grid gap-4 ${scenarios.length === 1 ? 'grid-cols-1 max-w-sm' : scenarios.length === 2 ? 'grid-cols-2' : scenarios.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
        {scenarios.map((s, i) => (
          <ScenarioCard
            key={i}
            scenario={s}
            index={i}
            color={SCENARIO_COLORS[i]}
            onChange={patch => updateScenario(i, patch)}
            onRemove={() => removeScenario(i)}
            canRemove={scenarios.length > 1}
          />
        ))}
        {scenarios.length < 4 && (
          <button
            onClick={addScenario}
            className="rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-2 p-6 text-muted-foreground hover:text-primary min-h-[200px]"
          >
            <Plus className="w-5 h-5" />
            <span className="text-xs">Add Scenario</span>
          </button>
        )}
      </div>

      {/* Run button */}
      <Button onClick={runAll} disabled={running} className="bg-primary text-primary-foreground gap-2">
        <Play className="w-3.5 h-3.5" />
        {running ? progress : `Run ${scenarios.length} Scenario${scenarios.length > 1 ? 's' : ''} (90-day real data)`}
      </Button>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          <div className={`grid gap-4 ${results.length === 1 ? 'grid-cols-1 max-w-sm' : results.length === 2 ? 'grid-cols-2' : results.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
            {results.map((r, i) => (
              <div key={i} className="space-y-2">
                <KpiGrid result={r} color={SCENARIO_COLORS[i]} />
                {r && (
                  <Button
                    size="sm"
                    onClick={() => handleSetLive(i)}
                    disabled={applyingIdx !== null}
                    className={`w-full text-xs gap-1.5 ${bestIdx === i ? 'bg-accent text-accent-foreground hover:bg-accent/90' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
                  >
                    {applyingIdx === i ? (
                      <span className="flex items-center gap-1"><div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> Applying…</span>
                    ) : (
                      <>
                        {bestIdx === i && <CheckCircle2 className="w-3 h-3" />}
                        {bestIdx === i ? '★ Set as Live Parameters' : 'Set as Live Parameters'}
                      </>
                    )}
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Overlay equity curves */}
          {equityCurves.length > 0 && (
            <EquityCurveOverlay curves={equityCurves} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Multi-curve equity overlay ────────────────────────────────────────────────
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, Legend
} from 'recharts';

function EquityCurveOverlay({ curves }) {
  // Merge all curves by idx
  const maxLen = Math.max(...curves.map(c => c.data.length));
  const merged = Array.from({ length: maxLen }, (_, i) => {
    const point = { idx: i + 1 };
    curves.forEach(c => { point[c.label] = c.data[i]?.balance ?? null; });
    return point;
  });

  return (
    <div className="rounded-lg border border-border bg-secondary/10 p-4">
      <p className="text-xs text-muted-foreground mb-3">Equity Curve Comparison</p>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={merged}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
            <XAxis dataKey="idx" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `$${v}`} />
            <ReTooltip
              contentStyle={{ background: 'hsl(220 18% 7%)', border: '1px solid hsl(220 14% 14%)', borderRadius: 8, fontSize: 11 }}
              formatter={(v, name) => [`$${Number(v).toFixed(2)}`, name]}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {curves.map(c => (
              <Line key={c.label} type="monotone" dataKey={c.label} stroke={c.color} strokeWidth={2} dot={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}