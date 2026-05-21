import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import {
  RefreshCw, CheckCircle2, AlertTriangle, XCircle,
  TrendingUp, TrendingDown, Zap, Target, Settings,
  ArrowRight, Activity, Clock
} from 'lucide-react';

// ─── helpers ────────────────────────────────────────────────────────────────

function Stat({ label, value, sub, color = 'text-foreground', mono = true }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground font-mono mb-0.5">{label}</p>
      <p className={`text-xl font-bold ${mono ? 'font-mono' : ''} ${color}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function VerdictBadge({ verdict }) {
  const map = {
    healthy:        { label: 'HEALTHY',         cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
    too_conservative: { label: 'TOO CONSERVATIVE', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    market_dead:    { label: 'MARKET DEAD',      cls: 'bg-muted text-muted-foreground border-border' },
    broken:         { label: 'BROKEN',           cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
    no_data:        { label: 'NO DATA',          cls: 'bg-muted text-muted-foreground border-border' },
  };
  const { label, cls } = map[verdict] || map.no_data;
  return <Badge className={`border text-xs font-mono ${cls}`}>{label}</Badge>;
}

const BUCKET_COLORS = {
  '0-5':   '#475569',
  '5-10':  '#0ea5e9',
  '10-15': '#f59e0b',
  '15-20': '#f97316',
  '20+':   '#22c55e',
};

function SettingRow({ pair, current, recommended, win_rate, avg_edge, avg_slippage, onApply }) {
  const diff = recommended ? recommended - current : 0;
  const needsChange = recommended && Math.abs(diff) >= 1;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-secondary/30 flex-wrap">
      <span className="font-mono font-bold text-sm w-20">{pair}</span>

      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Current floor</p>
          <p className="font-mono font-bold text-primary">{current} bps</p>
        </div>

        <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />

        <div className="text-center">
          <p className="text-xs text-muted-foreground">Recommended</p>
          <p className={`font-mono font-bold ${needsChange ? (diff > 0 ? 'text-red-400' : 'text-green-400') : 'text-muted-foreground'}`}>
            {recommended ? `${recommended} bps` : '—'}
          </p>
        </div>

        {needsChange && (
          <Badge className={`text-xs font-mono ${diff > 0 ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-green-500/20 text-green-400 border-green-500/30'} border`}>
            {diff > 0 ? `↑ +${diff}` : `↓ ${diff}`} bps
          </Badge>
        )}
      </div>

      <div className="flex gap-4 text-xs font-mono">
        {avg_edge != null && <span className="text-muted-foreground">edge: <span className="text-foreground">{avg_edge.toFixed(1)}</span></span>}
        {win_rate != null && <span className="text-muted-foreground">win: <span className={win_rate >= 0.6 ? 'text-green-400' : 'text-red-400'}>{(win_rate*100).toFixed(0)}%</span></span>}
        {avg_slippage != null && <span className="text-muted-foreground">slip: <span className="text-yellow-400">{avg_slippage.toFixed(1)}</span></span>}
      </div>

      {needsChange && onApply && (
        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => onApply(pair, recommended)}>
          Apply
        </Button>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function SignalAudit() {
  const [loading, setLoading] = useState(true);
  const [perf, setPerf] = useState(null);
  const [productivity, setProductivity] = useState(null);
  const [pairStats, setPairStats] = useState(null);
  const [config, setConfig] = useState(null);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [perfRes, prodRes, statsRes, cfgRes] = await Promise.allSettled([
        base44.functions.invoke('analyzeSignalPerformance', {}),
        base44.functions.invoke('botProductivity', { window_hours: 24 }),
        base44.functions.invoke('signalStats', { window_hours: 24 }),
        base44.entities.ArbConfig.list('-created_date', 1),
      ]);

      if (perfRes.status === 'fulfilled') setPerf(perfRes.value?.data);
      if (prodRes.status === 'fulfilled') setProductivity(prodRes.value?.data);
      if (statsRes.status === 'fulfilled') setPairStats(statsRes.value?.data);
      if (cfgRes.status === 'fulfilled') setConfig(cfgRes.value?.[0] || null);

      if (perfRes.status === 'rejected') setError('analyzeSignalPerformance failed: ' + perfRes.reason?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const applyThreshold = async (pair, newBps) => {
    if (!config?.id) return;
    setApplying(true);
    setApplyMsg(null);
    try {
      const asset = pair.split('-')[0];
      const field = `${asset.toLowerCase()}_min_edge_bps`;
      await base44.entities.ArbConfig.update(config.id, { [field]: newBps });
      setConfig(prev => ({ ...prev, [field]: newBps }));
      setApplyMsg(`✅ ${pair} floor updated to ${newBps} bps`);
    } catch (e) {
      setApplyMsg(`❌ Failed: ${e.message}`);
    } finally {
      setApplying(false);
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────

  const edgeBuckets = productivity?.distribution ? [
    { label: '0-5',  value: productivity.distribution.b0_5,   color: BUCKET_COLORS['0-5']  },
    { label: '5-10', value: productivity.distribution.b5_10,  color: BUCKET_COLORS['5-10'] },
    { label: '10-15',value: productivity.distribution.b10_15, color: BUCKET_COLORS['10-15']},
    { label: '15-20',value: productivity.distribution.b15_20, color: BUCKET_COLORS['15-20']},
    { label: '20+',  value: productivity.distribution.b20_plus,color: BUCKET_COLORS['20+'] },
  ] : [];

  const shadowPnl = productivity?.shadow_pnl || [];

  const pairRows = pairStats?.pairs?.filter(p => p.pair === 'BTC-USDT' || p.pair === 'ETH-USDT') || [];

  const verdict = productivity?.verdict || 'no_data';
  const execRate = perf?.summary?.execution_rate_pct ?? 0;

  // Overall reaction score 0-100
  const reactionScore = (() => {
    if (verdict === 'no_data') return null;
    let score = 50;
    if (execRate >= 25) score += 20;
    else if (execRate >= 10) score += 10;
    else score -= 10;
    if (verdict === 'healthy') score += 20;
    else if (verdict === 'too_conservative') score -= 20;
    else if (verdict === 'market_dead') score = Math.min(score, 40);
    const peak24h = productivity?.peak_edge_bps_24h || 0;
    if (peak24h >= 10) score += 10;
    return Math.max(0, Math.min(100, score));
  })();

  const scoreColor = reactionScore >= 70 ? 'text-green-400' : reactionScore >= 40 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            Signal Reaction Audit
          </h1>
          <p className="text-muted-foreground text-sm mt-1">End-to-end evaluation of signal detection → execution pipeline</p>
        </div>
        <Button onClick={load} variant="outline" size="sm" disabled={loading} className="gap-2">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Analyzing...' : 'Re-Audit'}
        </Button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <Card>
          <CardContent className="py-16 text-center">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-primary mb-3" />
            <p className="text-muted-foreground">Running signal pipeline audit across 3 data sources...</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Top-level verdict */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="col-span-2 md:col-span-1">
              <CardContent className="pt-5 pb-4">
                <p className="text-xs font-mono text-muted-foreground mb-1">REACTION SCORE</p>
                <p className={`text-4xl font-bold font-mono ${scoreColor}`}>
                  {reactionScore !== null ? reactionScore : '—'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">/ 100</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <p className="text-xs font-mono text-muted-foreground mb-2">BOT VERDICT</p>
                <VerdictBadge verdict={verdict} />
                <p className="text-xs text-muted-foreground mt-2">24h productivity</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <Stat
                  label="EXECUTION RATE"
                  value={`${execRate.toFixed(1)}%`}
                  sub={execRate >= 15 ? '✅ meets target' : '⚠️ below 15% target'}
                  color={execRate >= 25 ? 'text-green-400' : execRate >= 10 ? 'text-yellow-400' : 'text-red-400'}
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <Stat
                  label="PEAK EDGE 24H"
                  value={`${productivity?.peak_edge_bps_24h?.toFixed(1) ?? '—'} bps`}
                  sub={`1h: ${productivity?.peak_edge_bps_1h?.toFixed(1) ?? '—'} bps`}
                  color={productivity?.peak_edge_bps_24h >= 10 ? 'text-green-400' : 'text-yellow-400'}
                />
              </CardContent>
            </Card>
          </div>

          {/* Verdict explainer */}
          {verdict !== 'no_data' && (
            <Card className={`border ${
              verdict === 'healthy' ? 'border-green-500/30 bg-green-500/5'
              : verdict === 'too_conservative' ? 'border-yellow-500/30 bg-yellow-500/5'
              : verdict === 'market_dead' ? 'border-border'
              : 'border-red-500/30 bg-red-500/5'
            }`}>
              <CardContent className="py-4 flex items-start gap-3">
                {verdict === 'healthy' && <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />}
                {verdict === 'too_conservative' && <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />}
                {verdict === 'market_dead' && <TrendingDown className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />}
                {verdict === 'broken' && <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />}
                <div>
                  <p className="font-semibold text-sm">
                    {verdict === 'healthy' && 'Pipeline is executing within normal parameters.'}
                    {verdict === 'too_conservative' && 'Edge floor is too high — 10-20 bps opportunities are piling up unused.'}
                    {verdict === 'market_dead' && 'Market is quiet — no meaningful spread available. Not a bot problem.'}
                    {verdict === 'broken' && 'Execution pipeline is broken — signals detected but nothing is firing.'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {verdict === 'healthy' && `Executing at ${execRate.toFixed(1)}% rate. Peak edge ${productivity?.peak_edge_bps_24h?.toFixed(1)} bps seen in 24h.`}
                    {verdict === 'too_conservative' && `${productivity?.distribution?.b10_15 + productivity?.distribution?.b15_20} near-miss opportunities (10-20 bps) went unexecuted. Consider lowering the floor.`}
                    {verdict === 'market_dead' && 'Peak edge in 24h is below 3 bps. Wait for market conditions to improve.'}
                    {verdict === 'broken' && 'Check droplet connectivity, order server health, and executeSignals logs.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Edge distribution */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  Edge Distribution (24h)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {edgeBuckets.length > 0 && edgeBuckets.some(b => b.value > 0) ? (
                  <>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={edgeBuckets} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                        <Tooltip
                          formatter={v => [`${v} opps`, 'Count']}
                          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11 }}
                        />
                        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                          {edgeBuckets.map((b, i) => <Cell key={i} fill={b.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-3 mt-2">
                      {edgeBuckets.map(b => (
                        <div key={b.label} className="flex items-center gap-1 text-xs font-mono">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
                          <span className="text-muted-foreground">{b.label} bps</span>
                          <span className="font-bold">{b.value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">No heartbeat data in last 24h</p>
                )}
              </CardContent>
            </Card>

            {/* Shadow P&L — what if floor were lower? */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  Shadow P&L — Floor Sensitivity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {shadowPnl.length > 0 ? (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">Estimated total bps if floor were set at each level (50% edge retention)</p>
                    <ResponsiveContainer width="100%" height={140}>
                      <BarChart data={shadowPnl} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                        <XAxis dataKey="floor_bps" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} tickFormatter={v => `${v}bps`} />
                        <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                        <Tooltip
                          formatter={(v, n) => [n === 'est_total_bps' ? `${v} bps` : v, n === 'est_total_bps' ? 'Est. total bps' : 'Opportunities']}
                          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11 }}
                        />
                        <Bar dataKey="est_total_bps" fill="#0ea5e9" radius={[3, 3, 0, 0]} name="est_total_bps" />
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-2 space-y-1">
                      {shadowPnl.map(row => (
                        <div key={row.floor_bps} className="flex justify-between text-xs font-mono">
                          <span className="text-muted-foreground">Floor @ {row.floor_bps} bps</span>
                          <span>{row.opportunities} opps → <span className="text-primary">{row.est_total_bps} bps</span></span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">No heartbeat data</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Rejection breakdown */}
          {perf?.rejection_breakdown && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-400" />
                  Rejection Breakdown (last 500 signals)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(perf.rejection_breakdown)
                    .filter(([k]) => k !== 'total_rejected')
                    .map(([key, val]) => (
                      <div key={key} className="p-3 bg-secondary/40 rounded-lg">
                        <p className="text-lg font-bold font-mono">{val}</p>
                        <p className="text-xs text-muted-foreground">{key.replace(/_/g, ' ')}</p>
                      </div>
                    ))}
                </div>
                <div className="mt-3 p-3 bg-secondary/20 rounded-lg flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Total rejected:</span>
                  <span className="font-mono font-bold text-red-400">{perf.rejection_breakdown.total_rejected}</span>
                  <span className="text-muted-foreground ml-2">vs executed:</span>
                  <span className="font-mono font-bold text-green-400">{perf.summary?.executed}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Per-pair recommended settings */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Settings className="w-4 h-4 text-primary" />
                  Recommended Settings (per pair)
                </CardTitle>
                {applyMsg && (
                  <span className={`text-xs font-mono ${applyMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
                    {applyMsg}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Based on win rate, avg slippage, and signal edge over the last 24h
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {pairRows.length > 0 ? pairRows.map(row => (
                <SettingRow
                  key={row.pair}
                  pair={row.pair}
                  current={
                    row.pair === 'BTC-USDT'
                      ? (config?.btc_min_edge_bps ?? 3)
                      : (config?.eth_min_edge_bps ?? 3)
                  }
                  recommended={row.recommended_min_bps}
                  win_rate={row.win_rate}
                  avg_edge={row.avg_signal_edge_bps}
                  avg_slippage={row.avg_slippage_bps}
                  onApply={applying ? null : applyThreshold}
                />
              )) : (
                <div className="space-y-2">
                  {['BTC-USDT', 'ETH-USDT'].map(pair => (
                    <SettingRow
                      key={pair}
                      pair={pair}
                      current={pair === 'BTC-USDT' ? (config?.btc_min_edge_bps ?? 3) : (config?.eth_min_edge_bps ?? 3)}
                      recommended={null}
                      win_rate={null}
                      avg_edge={null}
                      avg_slippage={null}
                      onApply={null}
                    />
                  ))}
                  <p className="text-xs text-muted-foreground">Not enough executed trades to compute recommendation.</p>
                </div>
              )}

              {/* Current config summary */}
              {config && (
                <div className="mt-4 p-3 bg-secondary/30 rounded-lg grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                  <div><span className="text-muted-foreground">BTC floor: </span><span className="text-primary">{config.btc_min_edge_bps ?? 3} bps</span></div>
                  <div><span className="text-muted-foreground">ETH floor: </span><span className="text-primary">{config.eth_min_edge_bps ?? 3} bps</span></div>
                  <div><span className="text-muted-foreground">Paper: </span><span className={config.paper_trading ? 'text-yellow-400' : 'text-green-400'}>{config.paper_trading ? 'YES' : 'LIVE'}</span></div>
                  <div><span className="text-muted-foreground">Bot running: </span><span className={config.bot_running ? 'text-green-400' : 'text-red-400'}>{config.bot_running ? 'YES' : 'NO'}</span></div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Insights */}
          {perf?.insights?.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Audit Insights
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {perf.insights.map((insight, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="flex-shrink-0 mt-0.5">{insight.startsWith('✅') ? '✅' : insight.startsWith('❌') ? '❌' : '⚠️'}</span>
                      <span className="text-muted-foreground">{insight.replace(/^[✅❌⚠️]\s*/, '')}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}