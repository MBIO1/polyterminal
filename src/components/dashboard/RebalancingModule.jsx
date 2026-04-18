/**
 * RebalancingModule
 * ─────────────────
 * Reads real BotTrade data to compute:
 *   • Capital currently deployed in pending positions
 *   • Idle (stablecoin) capital = portfolio - deployed
 *   • Target allocation (configurable sliders)
 *   • Rebalancing actions needed to hit target
 *
 * Safety: will NOT suggest execution if the bot traded within 20 min.
 * No AI, no synthetic signals — pure arithmetic on real entity data.
 */
import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from 'recharts';
import { Scale, AlertTriangle, CheckCircle2, Clock, RefreshCw, ChevronRight } from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────
const BOT_COOLDOWN_MS = 20 * 60 * 1000; // 20 minutes
const COLORS = {
  idle:   'hsl(199 89% 48%)',   // blue — stablecoin / idle
  btc:    'hsl(45 93% 58%)',    // yellow — BTC positions
  eth:    'hsl(280 65% 60%)',   // purple — ETH positions
};

function formatPct(v) { return `${v.toFixed(1)}%`; }
function formatUsd(v) { return `$${v.toFixed(2)}`; }

// ── Allocation bar ────────────────────────────────────────────────────────────
const AllocBar = ({ label, actual, target, color, usd }) => {
  const diff = actual - target;
  const over = diff > 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground font-bold">{formatPct(actual)} <span className="text-muted-foreground font-normal">({formatUsd(usd)})</span></span>
      </div>
      <div className="relative h-2 rounded-full bg-secondary/60">
        {/* target marker */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-chart-4/60 z-10 rounded-full" style={{ left: `${Math.min(target, 100)}%` }} />
        {/* actual fill */}
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(actual, 100)}%`, background: color }} />
      </div>
      <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground">
        <span>Target: {formatPct(target)}</span>
        <span className={diff === 0 ? 'text-accent' : over ? 'text-chart-4' : 'text-primary'}>
          {diff > 0.5 ? `+${diff.toFixed(1)}% over` : diff < -0.5 ? `${diff.toFixed(1)}% under` : '✓ on target'}
        </span>
      </div>
    </div>
  );
};

// ── Action row ────────────────────────────────────────────────────────────────
const ActionRow = ({ label, amount, reason, type }) => (
  <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
    type === 'reduce' ? 'border-chart-4/30 bg-chart-4/5' : 'border-primary/30 bg-primary/5'
  }`}>
    <ChevronRight className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${type === 'reduce' ? 'text-chart-4' : 'text-primary'}`} />
    <div>
      <p className={`text-xs font-semibold font-mono ${type === 'reduce' ? 'text-chart-4' : 'text-primary'}`}>{label}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{reason}</p>
      <p className="text-[10px] font-mono text-foreground mt-0.5">Adj: <strong>{amount}</strong></p>
    </div>
  </div>
);

export default function RebalancingModule({ portfolioValue, startingBalance }) {
  const queryClient = useQueryClient();

  // Target allocation sliders (user-editable)
  const [targets, setTargets] = useState({ idle: 65, btc: 20, eth: 15 });
  const [applied, setApplied] = useState(false);

  const { data: trades = [] } = useQuery({
    queryKey: ['rebalance-trades'],
    queryFn: () => base44.entities.BotTrade.list('-created_date', 200),
    refetchInterval: 30000,
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

  // ── Real allocation from live BotTrade data ──────────────────────────────
  const alloc = useMemo(() => {
    const pending = trades.filter(t => t.outcome === 'pending');

    const btcDeployed = pending
      .filter(t => t.asset === 'BTC')
      .reduce((s, t) => s + (t.size_usdc || 0), 0);

    const ethDeployed = pending
      .filter(t => t.asset === 'ETH')
      .reduce((s, t) => s + (t.size_usdc || 0), 0);

    const totalDeployed = btcDeployed + ethDeployed;
    const port = portfolioValue || startingBalance || 1000;
    const idle = Math.max(0, port - totalDeployed);

    const idlePct  = (idle / port) * 100;
    const btcPct   = (btcDeployed / port) * 100;
    const ethPct   = (ethDeployed / port) * 100;

    return { idle, btcDeployed, ethDeployed, totalDeployed, idlePct, btcPct, ethPct, port, pendingCount: pending.length };
  }, [trades, portfolioValue, startingBalance]);

  // ── 20-min cooldown check (real trade timestamps) ────────────────────────
  const cooldownInfo = useMemo(() => {
    const now = Date.now();
    const recent = trades.find(t => (now - new Date(t.created_date).getTime()) < BOT_COOLDOWN_MS);
    if (!recent) return { active: false };
    const msLeft = BOT_COOLDOWN_MS - (now - new Date(recent.created_date).getTime());
    const minLeft = Math.ceil(msLeft / 60000);
    return { active: true, minLeft, lastTrade: recent.created_date };
  }, [trades]);

  // ── Rebalancing suggestions ──────────────────────────────────────────────
  const actions = useMemo(() => {
    const acts = [];
    const { idlePct, btcPct, ethPct, port } = alloc;
    const TOLERANCE = 5; // only act if > 5pp off target

    const idleDiff = idlePct - targets.idle;
    const btcDiff  = btcPct  - targets.btc;
    const ethDiff  = ethPct  - targets.eth;

    if (idleDiff > TOLERANCE) {
      const excess = (idleDiff / 100) * port;
      acts.push({
        type: 'deploy', label: 'Deploy idle capital',
        amount: formatUsd(excess),
        reason: `Idle is ${formatPct(idlePct)} vs target ${formatPct(targets.idle)}. Consider allowing bot to take more positions.`,
      });
    } else if (idleDiff < -TOLERANCE) {
      const deficit = (Math.abs(idleDiff) / 100) * port;
      acts.push({
        type: 'reduce', label: 'Reduce deployed capital',
        amount: formatUsd(deficit),
        reason: `Idle is ${formatPct(idlePct)} vs target ${formatPct(targets.idle)}. Reduce max_open_positions or cancel pending trades.`,
      });
    }

    if (btcDiff > TOLERANCE) {
      const excess = (btcDiff / 100) * port;
      acts.push({
        type: 'reduce', label: 'Trim BTC exposure',
        amount: formatUsd(excess),
        reason: `BTC at ${formatPct(btcPct)} vs target ${formatPct(targets.btc)}. Lower BTC position sizing.`,
      });
    } else if (btcDiff < -TOLERANCE) {
      const deficit = (Math.abs(btcDiff) / 100) * port;
      acts.push({
        type: 'deploy', label: 'Increase BTC allocation',
        amount: formatUsd(deficit),
        reason: `BTC at ${formatPct(btcPct)} vs target ${formatPct(targets.btc)}. Bot can deploy more into BTC contracts.`,
      });
    }

    if (ethDiff > TOLERANCE) {
      const excess = (ethDiff / 100) * port;
      acts.push({
        type: 'reduce', label: 'Trim ETH exposure',
        amount: formatUsd(excess),
        reason: `ETH at ${formatPct(ethPct)} vs target ${formatPct(targets.eth)}. Lower ETH position sizing.`,
      });
    } else if (ethDiff < -TOLERANCE) {
      const deficit = (Math.abs(ethDiff) / 100) * port;
      acts.push({
        type: 'deploy', label: 'Increase ETH allocation',
        amount: formatUsd(deficit),
        reason: `ETH at ${formatPct(ethPct)} vs target ${formatPct(targets.eth)}. Bot can deploy more into ETH contracts.`,
      });
    }

    return acts;
  }, [alloc, targets]);

  // ── Apply rebalance — adjusts BotConfig max_open_positions to enforce target ──
  const handleApply = async () => {
    if (cooldownInfo.active) {
      toast.error(`⏱ Bot traded ${cooldownInfo.minLeft}m ago — wait for 20-min cooldown`);
      return;
    }

    // Compute a sensible max_open_positions from target deployment %
    const activeTargetPct = (100 - targets.idle) / 100;
    const port = alloc.port;
    const config = configs[0] || {};
    const avgPositionSize = config.default_size_usdc || 10;
    const maxPos = Math.max(1, Math.floor((port * activeTargetPct) / avgPositionSize));

    await saveConfig.mutateAsync({ max_open_positions: maxPos });
    setApplied(true);
    toast.success(`✅ Rebalance applied — max open positions set to ${maxPos} (targets idle ${targets.idle}% / BTC ${targets.btc}% / ETH ${targets.eth}%)`);
    setTimeout(() => setApplied(false), 4000);
  };

  const totalTarget = targets.idle + targets.btc + targets.eth;
  const targetValid = Math.abs(totalTarget - 100) < 1;

  const pieData = [
    { name: 'Idle/Stable', value: Number(alloc.idlePct.toFixed(1)), fill: COLORS.idle },
    { name: 'BTC', value: Number(alloc.btcPct.toFixed(1)), fill: COLORS.btc },
    { name: 'ETH', value: Number(alloc.ethPct.toFixed(1)), fill: COLORS.eth },
  ].filter(d => d.value > 0);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Portfolio Rebalancer</h3>
            <p className="text-[10px] text-muted-foreground font-mono">{alloc.pendingCount} active positions · {formatUsd(alloc.totalDeployed)} deployed of {formatUsd(alloc.port)}</p>
          </div>
        </div>
        {cooldownInfo.active ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-chart-4/10 border border-chart-4/30 text-[10px] font-mono text-chart-4">
            <Clock className="w-3 h-3" />
            {cooldownInfo.minLeft}m cooldown
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/10 border border-accent/30 text-[10px] font-mono text-accent">
            <CheckCircle2 className="w-3 h-3" />
            Ready to rebalance
          </div>
        )}
      </div>

      {/* Cooldown warning */}
      {cooldownInfo.active && (
        <div className="flex items-start gap-2 rounded-lg border border-chart-4/30 bg-chart-4/5 px-3 py-2.5 text-[10px] font-mono text-chart-4">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Bot executed a trade {BOT_COOLDOWN_MS / 60000 - cooldownInfo.minLeft}m ago. Rebalance execution locked for {cooldownInfo.minLeft} more min to avoid interference with active bot logic.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* LEFT: pie + allocation bars */}
        <div className="space-y-4">
          <p className="text-xs font-semibold text-foreground">Current Allocation</p>

          {/* Pie chart */}
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={58} paddingAngle={3}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip
                  formatter={(v) => [`${v}%`]}
                  contentStyle={{ background: 'hsl(220 18% 7%)', border: '1px solid hsl(220 14% 14%)', borderRadius: 8, fontSize: 11, fontFamily: 'monospace' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex gap-3 flex-wrap justify-center text-[10px] font-mono">
            {[
              { label: 'Idle/Stable', color: COLORS.idle, pct: alloc.idlePct },
              { label: 'BTC', color: COLORS.btc, pct: alloc.btcPct },
              { label: 'ETH', color: COLORS.eth, pct: alloc.ethPct },
            ].map(d => (
              <div key={d.label} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                <span className="text-muted-foreground">{d.label}</span>
                <span className="text-foreground font-bold">{d.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>

          {/* Allocation bars */}
          <div className="space-y-3 pt-1">
            <AllocBar label="Idle / Stablecoin" actual={alloc.idlePct} target={targets.idle} color={COLORS.idle} usd={alloc.idle} />
            <AllocBar label="BTC Positions" actual={alloc.btcPct} target={targets.btc} color={COLORS.btc} usd={alloc.btcDeployed} />
            <AllocBar label="ETH Positions" actual={alloc.ethPct} target={targets.eth} color={COLORS.eth} usd={alloc.ethDeployed} />
          </div>
        </div>

        {/* RIGHT: target sliders + actions */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">Target Allocation</p>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${targetValid ? 'text-accent' : 'text-destructive'}`}>
              {totalTarget.toFixed(0)}% {targetValid ? '✓' : '≠ 100%'}
            </span>
          </div>

          {/* Sliders */}
          {[
            { key: 'idle', label: 'Idle / Stablecoin', color: COLORS.idle },
            { key: 'btc',  label: 'BTC Positions',     color: COLORS.btc },
            { key: 'eth',  label: 'ETH Positions',     color: COLORS.eth },
          ].map(({ key, label, color }) => (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                  <span className="text-muted-foreground">{label}</span>
                </div>
                <span className="text-foreground font-bold">{targets[key]}%</span>
              </div>
              <input
                type="range" min={0} max={100} step={5} value={targets[key]}
                onChange={e => setTargets(prev => ({ ...prev, [key]: parseInt(e.target.value) }))}
                className="w-full h-1 accent-primary"
              />
            </div>
          ))}

          {/* Suggested actions */}
          {actions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Suggested Actions</p>
              {actions.map((a, i) => <ActionRow key={i} {...a} />)}
            </div>
          ) : (
            <div className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2.5 flex items-center gap-2 text-xs font-mono text-accent">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Allocation is within 5pp of all targets — no rebalancing needed
            </div>
          )}

          {/* Apply button */}
          <button
            onClick={handleApply}
            disabled={!targetValid || cooldownInfo.active || saveConfig.isPending}
            className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {saveConfig.isPending ? (
              <div className="w-3.5 h-3.5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            ) : applied ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {saveConfig.isPending ? 'Applying…' : applied ? 'Applied ✓' : 'Apply Rebalance to Bot Config'}
          </button>
          <p className="text-[9px] font-mono text-muted-foreground text-center -mt-2">
            Adjusts <code>max_open_positions</code> to enforce target idle % · No trades are cancelled automatically
          </p>
        </div>
      </div>
    </div>
  );
}