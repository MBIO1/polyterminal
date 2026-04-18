/**
 * OptimizerTab — Grid-searches edge × lag × confidence combinations,
 * ranks by Sharpe ratio, and surfaces the top 3 configs for live deployment.
 */
import React, { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { runBacktest } from '@/lib/backtestEngine';
import { toast } from 'sonner';
import { Zap, Trophy, CheckCircle2, TrendingUp, TrendingDown } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

// ── Grid search space ──────────────────────────────────────────────────────────
const EDGE_VALUES   = [3, 5, 7, 10];
const LAG_VALUES    = [2, 3, 5, 7];
const CONF_VALUES   = [70, 80, 85, 90];
const KELLY_VALUES  = [0.25, 0.5, 0.75];
const MAX_POS_VALUES = [5, 8, 12];

function generateGrid() {
  const combos = [];
  for (const edge of EDGE_VALUES)
    for (const lag of LAG_VALUES)
      for (const conf of CONF_VALUES)
        combos.push({ edge_threshold: edge, lag_threshold: lag, confidence_threshold: conf,
                      kelly_fraction: 0.5, max_position_pct: 8, starting_balance: 1000 });
  return combos; // 4×4×4 = 64 combos — fast enough in-browser
}

const MEDALS = ['🥇', '🥈', '🥉'];

const Pill = ({ label, value, suffix = '', color = 'text-foreground' }) => (
  <div className="flex flex-col items-center px-3 py-2 rounded-lg bg-secondary/40 border border-border min-w-[60px]">
    <span className={`text-sm font-bold font-mono ${color}`}>{value}{suffix}</span>
    <span className="text-[9px] text-muted-foreground mt-0.5">{label}</span>
  </div>
);

function ResultCard({ rank, result, onDeploy, deploying }) {
  const { params: p, sharpe, winRate, totalPnl, maxDrawdown, trades, equity } = result;
  const isProfit = totalPnl >= 0;

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${
      rank === 0 ? 'border-chart-4/40 bg-chart-4/5' : 'border-border bg-card'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{MEDALS[rank]}</span>
          <div>
            <p className="text-sm font-bold text-foreground font-mono">
              Edge {p.edge_threshold}% · Lag {p.lag_threshold}pp · Conf {p.confidence_threshold}%
            </p>
            <p className="text-[10px] text-muted-foreground font-mono">
              Kelly {p.kelly_fraction} · Max pos {p.max_position_pct}%
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full border font-mono text-xs font-bold"
          style={{ borderColor: sharpe > 0.5 ? 'hsl(142 71% 45% / 0.4)' : 'hsl(45 93% 58% / 0.4)',
                   color: sharpe > 0.5 ? 'hsl(142 71% 45%)' : 'hsl(45 93% 58%)' }}>
          Sharpe {sharpe}
        </div>
      </div>

      {/* Metrics pills */}
      <div className="flex flex-wrap gap-2">
        <Pill label="Trades" value={trades} />
        <Pill label="Win Rate" value={winRate} suffix="%" color={winRate >= 50 ? 'text-accent' : 'text-destructive'} />
        <Pill label="P&L" value={`${isProfit ? '+' : ''}$${totalPnl}`} color={isProfit ? 'text-accent' : 'text-destructive'} />
        <Pill label="Max DD" value={maxDrawdown} suffix="%" color={maxDrawdown > 20 ? 'text-destructive' : maxDrawdown > 10 ? 'text-chart-4' : 'text-foreground'} />
      </div>

      {/* Mini equity curve */}
      {equity.length > 1 && (
        <div className="h-24">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equity}>
              <defs>
                <linearGradient id={`opt-grad-${rank}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isProfit ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)'} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={isProfit ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 2" stroke="hsl(220 14% 14%)" />
              <XAxis dataKey="label" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <ReferenceLine y={1000} stroke="hsl(45 93% 58%)" strokeDasharray="3 2" strokeWidth={1} />
              <Tooltip formatter={(v) => [`$${v}`, 'Portfolio']} contentStyle={{ background: 'hsl(220 18% 7%)', border: '1px solid hsl(220 14% 14%)', borderRadius: 8, fontSize: 11, fontFamily: 'monospace' }} />
              <Area type="monotone" dataKey="portfolio" stroke={isProfit ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)'} strokeWidth={1.5} fill={`url(#opt-grad-${rank})`} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <button
        onClick={() => onDeploy(result)}
        disabled={deploying}
        className={`flex items-center justify-center gap-2 w-full py-2 rounded-lg text-sm font-medium transition-all
          ${rank === 0
            ? 'bg-chart-4/20 border border-chart-4/40 text-chart-4 hover:bg-chart-4/30'
            : 'bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20'}
          disabled:opacity-50`}
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        {deploying ? 'Deploying...' : 'Deploy to Live Bot'}
      </button>
    </div>
  );
}

export default function OptimizerTab({ trades, configs }) {
  const queryClient = useQueryClient();
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [deployingRank, setDeployingRank] = useState(null);

  const settled = useMemo(() => trades.filter(t => t.outcome !== 'pending' && t.outcome !== 'cancelled'), [trades]);

  const saveConfig = useMutation({
    mutationFn: async (updates) => {
      if (configs.length > 0) return base44.entities.BotConfig.update(configs[0].id, updates);
      return base44.entities.BotConfig.create(updates);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bot-config'] }),
  });

  const handleOptimize = () => {
    if (settled.length < 5) {
      toast.error('Need at least 5 settled trades to optimize');
      return;
    }
    setRunning(true);
    setResults([]);
    setProgress(0);

    const combos = generateGrid();
    const allResults = [];

    // Run in batches to not block UI
    let i = 0;
    function runBatch() {
      const batchSize = 8;
      const end = Math.min(i + batchSize, combos.length);
      for (; i < end; i++) {
        const r = runBacktest(settled, combos[i]);
        if (r.trades >= 3) allResults.push(r); // skip configs with too few trades
      }
      setProgress(Math.round((i / combos.length) * 100));

      if (i < combos.length) {
        setTimeout(runBatch, 0);
      } else {
        // Sort by Sharpe, then by totalPnl as tiebreaker
        allResults.sort((a, b) => b.sharpe - a.sharpe || b.totalPnl - a.totalPnl);
        setResults(allResults.slice(0, 3));
        setRunning(false);
      }
    }
    setTimeout(runBatch, 0);
  };

  const handleDeploy = async (result, rank) => {
    setDeployingRank(rank);
    await saveConfig.mutateAsync({
      edge_threshold: result.params.edge_threshold,
      lag_threshold: result.params.lag_threshold,
      confidence_threshold: result.params.confidence_threshold,
      kelly_fraction: result.params.kelly_fraction,
      max_position_pct: result.params.max_position_pct,
    });
    setDeployingRank(null);
    toast.success(`🚀 Config deployed — Edge ${result.params.edge_threshold}% · Lag ${result.params.lag_threshold}pp · Conf ${result.params.confidence_threshold}% · Sharpe ${result.sharpe}`);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Parameter Optimizer</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Grid-searches {generateGrid().length} edge × lag × confidence combinations against {settled.length} settled trades.
            Ranks by <span className="text-foreground font-medium">Sharpe ratio</span> — suggests top 3 configs.
          </p>
        </div>
        <button
          onClick={handleOptimize}
          disabled={running || settled.length < 5}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
        >
          {running ? (
            <div className="w-4 h-4 border-2 border-primary-foreground/20 border-t-primary-foreground rounded-full animate-spin" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
          {running ? `Running… ${progress}%` : 'Run Optimizer'}
        </button>
      </div>

      {/* Progress bar */}
      {running && (
        <div className="rounded-full bg-secondary/50 h-1.5 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Info grid about search space */}
      {!running && results.length === 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Edge values tested', value: EDGE_VALUES.join(', '), suffix: '%' },
            { label: 'Lag values tested', value: LAG_VALUES.join(', '), suffix: 'pp' },
            { label: 'Confidence values', value: CONF_VALUES.join(', '), suffix: '%' },
            { label: 'Total combinations', value: EDGE_VALUES.length * LAG_VALUES.length * CONF_VALUES.length },
          ].map(item => (
            <div key={item.label} className="rounded-lg border border-border bg-secondary/30 px-3 py-2.5">
              <p className="text-xs font-bold font-mono text-foreground">{item.value}{item.suffix}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{item.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Not enough data warning */}
      {settled.length < 5 && (
        <div className="rounded-xl border border-chart-4/30 bg-chart-4/5 px-4 py-3 text-xs font-mono text-chart-4">
          ⚠️ Need at least 5 settled trades to run the optimizer. Currently: {settled.length}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-chart-4" />
            <h3 className="text-sm font-semibold text-foreground">Top 3 Configurations by Sharpe Ratio</h3>
            <span className="text-[10px] font-mono text-muted-foreground ml-auto">searched {generateGrid().length} combos</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {results.map((r, i) => (
              <ResultCard
                key={i}
                rank={i}
                result={r}
                onDeploy={(res) => handleDeploy(res, i)}
                deploying={deployingRank === i}
              />
            ))}
          </div>

          {/* Comparison table */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Side-by-side comparison</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="pb-2 text-left">Rank</th>
                    <th className="pb-2 text-right">Edge</th>
                    <th className="pb-2 text-right">Lag</th>
                    <th className="pb-2 text-right">Conf</th>
                    <th className="pb-2 text-right">Trades</th>
                    <th className="pb-2 text-right">Win%</th>
                    <th className="pb-2 text-right">P&L</th>
                    <th className="pb-2 text-right">Max DD</th>
                    <th className="pb-2 text-right">Sharpe</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b border-border/20 hover:bg-secondary/20 transition-colors">
                      <td className="py-1.5">{MEDALS[i]}</td>
                      <td className="py-1.5 text-right">{r.params.edge_threshold}%</td>
                      <td className="py-1.5 text-right">{r.params.lag_threshold}pp</td>
                      <td className="py-1.5 text-right">{r.params.confidence_threshold}%</td>
                      <td className="py-1.5 text-right">{r.trades}</td>
                      <td className={`py-1.5 text-right font-bold ${r.winRate >= 50 ? 'text-accent' : 'text-destructive'}`}>{r.winRate}%</td>
                      <td className={`py-1.5 text-right font-bold ${r.totalPnl >= 0 ? 'text-accent' : 'text-destructive'}`}>{r.totalPnl >= 0 ? '+' : ''}${r.totalPnl}</td>
                      <td className={`py-1.5 text-right ${r.maxDrawdown > 20 ? 'text-destructive' : r.maxDrawdown > 10 ? 'text-chart-4' : 'text-foreground'}`}>{r.maxDrawdown}%</td>
                      <td className={`py-1.5 text-right font-bold ${r.sharpe > 0 ? 'text-accent' : 'text-destructive'}`}>{r.sharpe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}