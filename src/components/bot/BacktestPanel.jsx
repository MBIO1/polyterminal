import React, { useState, useCallback } from 'react';
import { runBacktest } from '@/lib/backtester';
import { Button } from '@/components/ui/button';
import { FlaskConical, TrendingUp, TrendingDown, Zap, CheckCircle2, Loader2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

export default function BacktestPanel({ onApplyThresholds }) {
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [result, setResult] = useState(null);

  const onProgress = useCallback((msg, pct) => {
    setProgressMsg(msg);
    setProgress(pct);
  }, []);

  const handleRun = async () => {
    setStatus('running');
    setProgress(0);
    setResult(null);
    try {
      const r = await runBacktest(onProgress);
      setResult(r);
      setStatus('done');
    } catch (e) {
      console.error(e);
      setStatus('error');
    }
  };

  const handleApply = () => {
    if (!result?.recommendedThresholds) return;
    const t = result.recommendedThresholds;
    onApplyThresholds({
      lag_threshold: t.lag,
      edge_threshold: t.edge,
      confidence_threshold: t.confidence,
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">200-Trade Backtest</h3>
          <span className="text-[10px] font-mono text-muted-foreground">3-month real price history</span>
        </div>
        {status === 'done' && result && (
          <span className="text-[10px] font-mono text-accent">{result.dataSource}</span>
        )}
      </div>

      {/* Idle state */}
      {status === 'idle' && (
        <div className="text-center py-6 space-y-3">
          <p className="text-xs text-muted-foreground font-mono leading-relaxed">
            Fetches 90 days of real BTC/ETH price data from CoinGecko,<br />
            runs a grid-search over lag / edge / confidence thresholds<br />
            across 200 simulated trades to find the optimal signal parameters.
          </p>
          <Button onClick={handleRun} className="bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 font-mono text-xs">
            <FlaskConical className="w-3.5 h-3.5 mr-1.5" /> Run Backtest
          </Button>
        </div>
      )}

      {/* Running */}
      {status === 'running' && (
        <div className="space-y-3 py-4">
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
            {progressMsg}
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] font-mono text-muted-foreground text-right">{progress}%</p>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="text-center py-4 text-destructive text-xs font-mono">
          Backtest failed. <button onClick={handleRun} className="underline">Retry</button>
        </div>
      )}

      {/* Results */}
      {status === 'done' && result && (
        <div className="space-y-4">
          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Trades', value: result.tradeCount, color: 'text-foreground' },
              { label: 'Win Rate', value: `${result.winRate.toFixed(1)}%`, color: result.winRate >= 55 ? 'text-accent' : 'text-chart-4' },
              { label: 'P&L', value: `${result.totalPnl >= 0 ? '+' : ''}$${result.totalPnl.toFixed(2)}`, color: result.totalPnl >= 0 ? 'text-accent' : 'text-destructive' },
              { label: 'Max DD', value: `${result.maxDrawdown.toFixed(1)}%`, color: result.maxDrawdown > 30 ? 'text-destructive' : 'text-foreground' },
              { label: 'Profit Factor', value: result.profitFactor.toFixed(2), color: result.profitFactor >= 1.5 ? 'text-accent' : 'text-chart-4' },
            ].map(k => (
              <div key={k.label} className="rounded-lg bg-secondary/40 border border-border px-3 py-2 text-center">
                <p className="text-[10px] text-muted-foreground font-mono mb-0.5">{k.label}</p>
                <p className={`text-base font-mono font-bold ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          {/* Equity curve */}
          {result.priceSeries.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-muted-foreground mb-2">Equity Curve — best scenario</p>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={result.priceSeries}>
                  <XAxis dataKey="idx" hide />
                  <YAxis domain={['auto', 'auto']} hide />
                  <Tooltip
                    contentStyle={{ background: 'hsl(220 18% 7%)', border: '1px solid hsl(220 14% 14%)', fontSize: 11, fontFamily: 'monospace' }}
                    formatter={(v, n) => [n === 'balance' ? `$${v}` : `$${v}`, n]}
                    labelFormatter={l => `Trade #${l}`}
                  />
                  <ReferenceLine y={1000} stroke="hsl(215 14% 50%)" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="balance" stroke="hsl(142 71% 45%)" dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Recommended thresholds */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-accent" />
              <p className="text-xs font-semibold text-foreground">Recommended Signal Thresholds</p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: 'Lag', value: `${result.recommendedThresholds.lag}pp`, sub: 'min lag' },
                { label: 'Edge', value: `${result.recommendedThresholds.edge}%`, sub: 'min edge' },
                { label: 'Confidence', value: `${result.recommendedThresholds.confidence}%`, sub: 'min conf' },
              ].map(t => (
                <div key={t.label} className="rounded-lg bg-primary/10 border border-primary/20 px-2 py-2">
                  <p className="text-[9px] font-mono text-muted-foreground uppercase">{t.label}</p>
                  <p className="text-lg font-mono font-bold text-primary">{t.value}</p>
                  <p className="text-[9px] text-muted-foreground">{t.sub}</p>
                </div>
              ))}
            </div>

            {/* Per-scenario breakdown */}
            <div className="space-y-1">
              {Object.entries(result.scenarios).filter(([, v]) => v).map(([name, s]) => (
                <div key={name} className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                  <span className="text-foreground/70">{name}</span>
                  <span>lag≥{s.lag}pp edge≥{s.edge}% conf≥{s.conf}%</span>
                  <span className={s.winRate >= 55 ? 'text-accent' : 'text-chart-4'}>{s.winRate.toFixed(0)}% WR</span>
                  <span className={s.totalPnl >= 0 ? 'text-accent' : 'text-destructive'}>{s.totalPnl >= 0 ? '+' : ''}${s.totalPnl.toFixed(0)}</span>
                </div>
              ))}
            </div>

            <Button
              onClick={handleApply}
              className="w-full bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 font-mono text-xs h-8"
            >
              <Zap className="w-3.5 h-3.5 mr-1.5" /> Apply Thresholds to Bot Config
            </Button>
          </div>

          <button onClick={handleRun} className="text-[10px] font-mono text-muted-foreground hover:text-foreground underline">
            Re-run backtest
          </button>
        </div>
      )}
    </div>
  );
}