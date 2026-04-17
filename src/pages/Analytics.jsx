import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell
} from 'recharts';
import { format, startOfDay, subDays } from 'date-fns';
import { runBacktest } from '@/lib/backtester';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';

// ── Tooltip helper ────────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label, prefix = '', suffix = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs font-mono">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-bold">
          {p.name}: {prefix}{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}{suffix}
        </p>
      ))}
    </div>
  );
};

// ── Section wrapper ───────────────────────────────────────────────────────────
const Section = ({ title, subtitle, children }) => (
  <div className="rounded-xl border border-border bg-card p-5">
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
    {children}
  </div>
);

export default function Analytics() {
  const { data: trades = [] } = useQuery({
    queryKey: ['bot-trades-analytics'],
    queryFn: () => base44.entities.BotTrade.list('-created_date', 500),
  });

  // ── P&L Cumulative ────────────────────────────────────────────────────────
  const pnlSeries = useMemo(() => {
    const sorted = [...trades].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    let cum = 0;
    return sorted.map((t, i) => {
      cum += t.pnl_usdc || 0;
      return { idx: i + 1, pnl: Number((t.pnl_usdc || 0).toFixed(3)), cumPnl: Number(cum.toFixed(3)), date: t.created_date?.slice(0, 10) };
    });
  }, [trades]);

  // ── Daily Win Rate ────────────────────────────────────────────────────────
  const dailyWinRate = useMemo(() => {
    const map = {};
    trades.forEach(t => {
      const day = t.created_date?.slice(0, 10);
      if (!day) return;
      if (!map[day]) map[day] = { wins: 0, total: 0 };
      map[day].total++;
      if (t.outcome === 'win') map[day].wins++;
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, { wins, total }]) => ({
        date: date.slice(5), // MM-DD
        winRate: total > 0 ? Number(((wins / total) * 100).toFixed(1)) : 0,
        total,
      }));
  }, [trades]);

  // ── Edge vs Return scatter ────────────────────────────────────────────────
  const edgeScatter = useMemo(() =>
    trades
      .filter(t => t.edge_at_entry != null && t.pnl_usdc != null)
      .map(t => ({ edge: Number((t.edge_at_entry || 0).toFixed(2)), pnl: Number((t.pnl_usdc || 0).toFixed(3)), win: t.outcome === 'win' })),
    [trades]
  );

  // ── Daily P&L bars ────────────────────────────────────────────────────────
  const dailyPnl = useMemo(() => {
    const map = {};
    trades.forEach(t => {
      const day = t.created_date?.slice(0, 10);
      if (!day) return;
      map[day] = (map[day] || 0) + (t.pnl_usdc || 0);
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, pnl]) => ({ date: date.slice(5), pnl: Number(pnl.toFixed(2)) }));
  }, [trades]);

  // ── Backtest state ────────────────────────────────────────────────────────
  const [btLag, setBtLag] = useState(3);
  const [btEdge, setBtEdge] = useState(5);
  const [btConf, setBtConf] = useState(85);
  const [btResult, setBtResult] = useState(null);
  const [btRunning, setBtRunning] = useState(false);
  const [btLog, setBtLog] = useState('');

  const runBt = async () => {
    setBtRunning(true);
    setBtResult(null);
    try {
      const res = await runBacktest((msg, pct) => setBtLog(`${msg} (${pct}%)`));
      setBtResult(res);
    } finally {
      setBtRunning(false);
    }
  };

  const totalPnl = trades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
  const wins = trades.filter(t => t.outcome === 'win').length;
  const winRate = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : 0;

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <p className="text-xs text-muted-foreground mt-1 font-mono">
          {trades.length} trades · Win rate {winRate}% · Total P&L {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
        </p>
      </div>

      {trades.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground text-sm">
          No trades recorded yet — start the bot to generate data
        </div>
      ) : (
        <div className="space-y-6">
          {/* Row 1: cumulative P&L + daily P&L */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section title="Cumulative P&L" subtitle="Running total across all bot trades">
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={pnlSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="idx" tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<ChartTooltip prefix="$" />} />
                    <ReferenceLine y={0} stroke="hsl(215 14% 30%)" strokeDasharray="4 2" />
                    <Line type="monotone" dataKey="cumPnl" name="Cum P&L" stroke="hsl(199 89% 48%)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Section>

            <Section title="Daily P&L" subtitle="Net profit/loss per day (last 30 days)">
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyPnl}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<ChartTooltip prefix="$" />} />
                    <ReferenceLine y={0} stroke="hsl(215 14% 30%)" />
                    <Bar dataKey="pnl" name="P&L" radius={[3, 3, 0, 0]}>
                      {dailyPnl.map((d, i) => (
                        <Cell key={i} fill={d.pnl >= 0 ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          </div>

          {/* Row 2: Daily win rate + Edge vs Return */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section title="Daily Win Rate" subtitle="% of winning trades per day">
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyWinRate}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `${v}%`} />
                    <Tooltip content={<ChartTooltip suffix="%" />} />
                    <ReferenceLine y={50} stroke="hsl(45 93% 58%)" strokeDasharray="4 2" label={{ value: '50%', fill: 'hsl(45 93% 58%)', fontSize: 9, position: 'right' }} />
                    <Bar dataKey="winRate" name="Win Rate" radius={[3, 3, 0, 0]}>
                      {dailyWinRate.map((d, i) => (
                        <Cell key={i} fill={d.winRate >= 50 ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>

            <Section title="Edge vs Return" subtitle="Each dot = one trade · green = win, red = loss">
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                    <XAxis dataKey="edge" name="Edge %" type="number" tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `${v}%`} />
                    <YAxis dataKey="pnl" name="P&L" type="number" tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `$${v}`} />
                    <ReferenceLine y={0} stroke="hsl(215 14% 30%)" />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload;
                      return (
                        <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs font-mono">
                          <p className="text-muted-foreground">Edge: {d?.edge}%</p>
                          <p className={d?.pnl >= 0 ? 'text-accent' : 'text-destructive'}>P&L: ${d?.pnl}</p>
                        </div>
                      );
                    }} />
                    <Scatter data={edgeScatter} name="Trades">
                      {edgeScatter.map((d, i) => (
                        <Cell key={i} fill={d.win ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)'} fillOpacity={0.7} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </Section>
          </div>
        </div>
      )}

      {/* ── Backtest Section ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-1">Backtest — 90-Day Simulation</h3>
        <p className="text-xs text-muted-foreground mb-5">
          Simulate how the bot would have performed on real BTC/ETH price history (CoinGecko). Adjust thresholds and run to find optimal parameters.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-5">
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-xs text-muted-foreground">Lag Threshold</Label>
              <span className="text-xs font-mono font-bold text-foreground">{btLag}pp</span>
            </div>
            <Slider value={[btLag]} onValueChange={([v]) => setBtLag(v)} min={1} max={10} step={0.5} />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-xs text-muted-foreground">Edge Threshold</Label>
              <span className="text-xs font-mono font-bold text-foreground">{btEdge}%</span>
            </div>
            <Slider value={[btEdge]} onValueChange={([v]) => setBtEdge(v)} min={1} max={20} step={0.5} />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="text-xs text-muted-foreground">Confidence Threshold</Label>
              <span className="text-xs font-mono font-bold text-foreground">{btConf}%</span>
            </div>
            <Slider value={[btConf]} onValueChange={([v]) => setBtConf(v)} min={50} max={99} />
          </div>
        </div>

        <Button onClick={runBt} disabled={btRunning} className="mb-5 bg-primary text-primary-foreground">
          {btRunning ? `Running… ${btLog}` : '▶ Run Backtest (90-day real data)'}
        </Button>

        {btResult && (
          <div className="space-y-5">
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Trades', value: btResult.tradeCount },
                { label: 'Win Rate', value: `${btResult.winRate.toFixed(1)}%`, color: btResult.winRate >= 50 ? 'text-accent' : 'text-destructive' },
                { label: 'Total P&L', value: `${btResult.totalPnl >= 0 ? '+' : ''}$${btResult.totalPnl.toFixed(2)}`, color: btResult.totalPnl >= 0 ? 'text-accent' : 'text-destructive' },
                { label: 'Max Drawdown', value: `${btResult.maxDrawdown.toFixed(1)}%`, color: btResult.maxDrawdown > 20 ? 'text-destructive' : 'text-foreground' },
                { label: 'Profit Factor', value: btResult.profitFactor.toFixed(2), color: btResult.profitFactor >= 1.2 ? 'text-accent' : 'text-destructive' },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-lg bg-secondary/40 border border-border px-3 py-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
                  <p className={`text-sm font-mono font-bold ${color || 'text-foreground'}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Recommended thresholds */}
            <div className="rounded-lg bg-accent/5 border border-accent/20 px-4 py-3 text-xs font-mono">
              <span className="text-accent font-bold">✓ Grid-search optimum: </span>
              Lag {btResult.recommendedThresholds.lag}pp · Edge {btResult.recommendedThresholds.edge}% · Conf {btResult.recommendedThresholds.confidence}%
              <span className="text-muted-foreground ml-2">(avg across BTC/ETH 5-min &amp; 15-min)</span>
            </div>

            {/* Equity curve */}
            {btResult.priceSeries?.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Equity Curve</p>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={btResult.priceSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
                      <XAxis dataKey="idx" tick={{ fontSize: 9, fill: 'hsl(215 14% 50%)' }} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }} tickLine={false} tickFormatter={v => `$${v}`} />
                      <Tooltip content={<ChartTooltip prefix="$" />} />
                      <Line type="monotone" dataKey="balance" name="Balance" stroke="hsl(199 89% 48%)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">Data source: {btResult.dataSource}</p>
          </div>
        )}
      </div>
    </div>
  );
}