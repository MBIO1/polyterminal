import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { runBacktest } from '@/lib/backtestEngine';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';
import { toast } from 'sonner';
import { Play, RotateCcw, CheckCircle2, TrendingUp, TrendingDown, Zap } from 'lucide-react';
import OptimizerTab from '@/components/backtester/OptimizerTab';
import TimeframeSelector from '@/components/backtester/TimeframeSelector';

const DEFAULT_PARAMS = {
  edge_threshold: 5,
  lag_threshold: 3,
  confidence_threshold: 80,
  kelly_fraction: 0.5,
  max_position_pct: 8,
  starting_balance: 1000,
  timeframeId: 'all',
};

const TABS = ['Manual Backtest', 'Optimizer'];

const SliderRow = ({ label, value, min, max, step, onChange, suffix = '' }) => (
  <div className="flex items-center gap-3">
    <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="flex-1 h-1 accent-primary"
    />
    <span className="text-xs font-mono text-foreground w-14 text-right">{value}{suffix}</span>
  </div>
);

const KPI = ({ label, value, color = 'text-foreground' }) => (
  <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
    <p className="text-[10px] text-muted-foreground font-mono mb-0.5">{label}</p>
    <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
  </div>
);

export default function Backtester() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState('all');

  const { data: trades = [] } = useQuery({
    queryKey: ['backtest-trades'],
    queryFn: () => base44.entities.BotTrade.list('-created_date', 2000),
  });

  const { data: configs = [] } = useQuery({
    queryKey: ['bot-config'],
    queryFn: () => base44.entities.BotConfig.list(),
  });

  const saveConfig = useMutation({
    mutationFn: async (updates) => {
      if (configs.length > 0) return base44.entities.BotConfig.update(configs[0].id, updates);
      return base44.entities.BotConfig.create(updates);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bot-config'] }),
  });

  const handleRun = () => {
    setRunning(true);
    setTimeout(() => {
      const res = runBacktest(trades, { ...params, timeframeId: selectedTimeframe });
      setResult(res);
      setRunning(false);
    }, 400);
  };

  const handleDeploy = async () => {
    await saveConfig.mutateAsync({
      edge_threshold: params.edge_threshold,
      lag_threshold: params.lag_threshold,
      confidence_threshold: params.confidence_threshold,
      kelly_fraction: params.kelly_fraction,
      max_position_pct: params.max_position_pct,
    });
    toast.success('✅ Backtest parameters deployed to live bot!');
  };

  const set = (key) => (val) => setParams(p => ({ ...p, [key]: val }));

  const eligibleCount = useMemo(() =>
    trades.filter(t =>
      t.outcome !== 'pending' && t.outcome !== 'cancelled' &&
      (t.edge_at_entry || 0) >= params.edge_threshold &&
      (t.confidence_at_entry || 0) >= params.confidence_threshold
    ).length,
    [trades, params.edge_threshold, params.confidence_threshold]
  );

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Backtester</h1>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          {trades.filter(t => t.outcome !== 'pending').length} settled trades available for replay
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-secondary/50 border border-border w-fit">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === i ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {i === 1 && <Zap className="w-3 h-3" />}
            {tab}
          </button>
        ))}
      </div>

      {/* ── Manual Backtest Tab ─────────────────────────────────────────────── */}
      {activeTab === 0 && (
        <div className="space-y-6">
          {/* Timeframe Selector */}
          <TimeframeSelector
            trades={trades}
            selected={selectedTimeframe}
            onChange={setSelectedTimeframe}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Controls */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-5">
              <h3 className="text-sm font-semibold text-foreground">Risk Parameters</h3>
            <div className="space-y-4">
              <SliderRow label="Edge Threshold" value={params.edge_threshold} min={1} max={20} step={0.5} onChange={set('edge_threshold')} suffix="%" />
              <SliderRow label="Lag Threshold" value={params.lag_threshold} min={1} max={15} step={0.5} onChange={set('lag_threshold')} suffix="pp" />
              <SliderRow label="Confidence" value={params.confidence_threshold} min={50} max={99} step={1} onChange={set('confidence_threshold')} suffix="%" />
              <SliderRow label="Kelly Fraction" value={params.kelly_fraction} min={0.1} max={1} step={0.05} onChange={set('kelly_fraction')} />
              <SliderRow label="Max Position" value={params.max_position_pct} min={1} max={20} step={0.5} onChange={set('max_position_pct')} suffix="%" />
            </div>

            <div className="rounded-lg bg-secondary/40 px-3 py-2 text-xs font-mono text-muted-foreground">
              <span className="text-foreground font-bold">{eligibleCount}</span> trades qualify
              <span className="block mt-0.5">of {trades.filter(t => t.outcome !== 'pending').length} settled</span>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={handleRun}
                disabled={running || trades.length === 0}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
              >
                {running ? <div className="w-4 h-4 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" /> : <Play className="w-4 h-4" />}
                {running ? 'Running...' : 'Run Backtest'}
              </button>
              <button
                onClick={() => { setParams(DEFAULT_PARAMS); setResult(null); }}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            </div>

            {result && (
              <button
                onClick={handleDeploy}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 transition-all"
              >
                <CheckCircle2 className="w-4 h-4" />
                Deploy to Live Bot
              </button>
            )}
          </div>

          {/* Results */}
          <div className="lg:col-span-2 space-y-4">
            {!result ? (
              <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground">
                <Play className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Configure parameters and click <strong className="text-foreground">Run Backtest</strong></p>
                <p className="text-xs mt-1">Replays your actual trade history with new risk rules</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KPI label="Trades Taken" value={result.trades} />
                  <KPI label="Win Rate" value={`${result.winRate}%`} color={result.winRate >= 50 ? 'text-accent' : 'text-destructive'} />
                  <KPI label="Total P&L" value={`${result.totalPnl >= 0 ? '+' : ''}$${result.totalPnl}`} color={result.totalPnl >= 0 ? 'text-accent' : 'text-destructive'} />
                  <KPI label="Sharpe Ratio" value={result.sharpe} color={result.sharpe > 0 ? 'text-accent' : 'text-destructive'} />
                  <KPI label="Wins" value={result.wins} color="text-accent" />
                  <KPI label="Losses" value={result.losses} color="text-destructive" />
                  <KPI label="Max Drawdown" value={`${result.maxDrawdown}%`} color={result.maxDrawdown > 20 ? 'text-destructive' : result.maxDrawdown > 10 ? 'text-chart-4' : 'text-foreground'} />
                  <KPI label="Final Portfolio" value={`$${result.finalPortfolio}`} color="text-primary" />
                </div>

                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-1">Equity Curve</h3>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={result.equity}>
                        <defs>
                          <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={result.totalPnl >= 0 ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)'} stopOpacity={0.25} />
                            <stop offset="95%" stopColor={result.totalPnl >= 0 ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)'} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                        <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `$${v}`} />
                        <Tooltip formatter={(v) => [`$${v}`, 'Portfolio']} contentStyle={{ background: 'hsl(220 18% 7%)', border: '1px solid hsl(220 14% 14%)', borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }} />
                        <ReferenceLine y={params.starting_balance} stroke="hsl(45 93% 58%)" strokeDasharray="4 2" />
                        <Area type="monotone" dataKey="portfolio" stroke={result.totalPnl >= 0 ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)'} strokeWidth={2} fill="url(#equityGrad)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {result.dailyPnl.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-1">Daily P&L (Backtest)</h3>
                    <div className="h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={result.dailyPnl}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                          <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `$${v}`} />
                          <Tooltip formatter={(v) => [`$${v}`, 'P&L']} contentStyle={{ background: 'hsl(220 18% 7%)', border: '1px solid hsl(220 14% 14%)', borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }} />
                          <ReferenceLine y={0} stroke="hsl(215 14% 30%)" />
                          <Bar dataKey="pnl" name="P&L" radius={[3, 3, 0, 0]}>
                            {result.dailyPnl.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)'} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                <div className={`rounded-xl border p-4 flex items-start gap-3 ${result.totalPnl >= 0 ? 'border-accent/30 bg-accent/5' : 'border-destructive/30 bg-destructive/5'}`}>
                  {result.totalPnl >= 0 ? <TrendingUp className="w-5 h-5 text-accent mt-0.5" /> : <TrendingDown className="w-5 h-5 text-destructive mt-0.5" />}
                  <div>
                    <p className={`text-sm font-semibold font-mono ${result.totalPnl >= 0 ? 'text-accent' : 'text-destructive'}`}>
                      {result.totalPnl >= 0 ? '✅ Profitable Strategy' : '⚠️ Unprofitable Strategy'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {result.trades} trades · {result.winRate}% win rate · Sharpe {result.sharpe} · {result.maxDrawdown}% max drawdown
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Optimizer Tab ───────────────────────────────────────────────────── */}
      {activeTab === 1 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <OptimizerTab trades={trades} configs={configs} />
        </div>
      )}
    </div>
  );
}