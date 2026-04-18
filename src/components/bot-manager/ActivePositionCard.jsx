/**
 * ActivePositionCard
 * Real-time PnL estimate using live CEX prices + trailing stop / take-profit UI.
 * PnL = f(live asset price movement × position side × entry probability)
 */
import React, { useState, useMemo } from 'react';
import { Clock, X, ChevronDown, ChevronUp, Target, Shield } from 'lucide-react';

function elapsed(dateStr) {
  const ms = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/**
 * Estimate live mark-to-market PnL using real CEX prices.
 *
 * Logic: The short-term contract price (polymarket) should converge toward
 * the CEX-implied probability as time passes. We proxy the "current mark"
 * from the live asset price momentum vs the entry price momentum.
 *
 * If BTC moved +0.5% since we entered a YES contract at 0.55¢ → mark drifts up.
 */
function estimateLivePnl(trade, prices) {
  if (!trade || !prices) return { pnl: 0, markPrice: trade?.entry_price || 0.5, pnlPct: 0 };

  const entry  = trade.entry_price || 0.5;
  const size   = trade.size_usdc || 0;
  const shares = trade.shares || 0;

  const assetPrice  = trade.asset === 'BTC' ? prices.btc?.price : prices.eth?.price;
  const assetPrev   = trade.asset === 'BTC' ? (prices.btc?.prev || prices.btc?.price) : (prices.eth?.prev || prices.eth?.price);

  if (!assetPrice || !assetPrev || assetPrev === 0) return { pnl: 0, markPrice: entry, pnlPct: 0 };

  const vol = trade.asset === 'BTC' ? 0.012 : 0.018;
  const pctMove = (assetPrice - assetPrev) / assetPrev;
  const momentum = pctMove / vol;
  // Sigmoid → implied probability of up move
  const probUp = 1 / (1 + Math.exp(-momentum * 2.5));
  const contractIsUp = trade.contract_type?.includes('up');
  const rawMark = contractIsUp ? probUp : 1 - probUp;
  // Clamp mark to sane range
  const mark = Math.max(0.02, Math.min(0.98, rawMark));

  // PnL = delta × shares  (if YES: we profit when mark > entry)
  const delta = trade.side === 'yes' ? mark - entry : entry - mark;
  const pnl = delta * shares;
  const pnlPct = size > 0 ? (pnl / size) * 100 : 0;

  return { pnl, markPrice: mark, pnlPct };
}

export default function ActivePositionCard({ trade, prices, onCancel, onSetStop, onSetTakeProfit, cancelling }) {
  const [expanded, setExpanded] = useState(false);
  const [stopPct, setStopPct] = useState(20);      // trailing stop %
  const [tpPct, setTpPct]     = useState(50);       // take-profit %
  const [stopArmed, setStopArmed] = useState(false);
  const [tpArmed, setTpArmed]   = useState(false);

  const age    = Date.now() - new Date(trade.created_date).getTime();
  const ageMin = age / 60000;
  const urgent = ageMin >= 4;

  const { pnl, markPrice, pnlPct } = useMemo(
    () => estimateLivePnl(trade, prices),
    [trade, prices]
  );

  const pnlPositive = pnl >= 0;

  // Check if stop/tp conditions are met
  const stopThreshold = -(stopPct / 100) * (trade.size_usdc || 0);
  const tpThreshold   = (tpPct / 100) * (trade.size_usdc || 0);
  const stopTriggered = stopArmed && pnl <= stopThreshold;
  const tpTriggered   = tpArmed  && pnl >= tpThreshold;

  const handleArmStop = () => {
    setStopArmed(true);
    onSetStop?.(trade, stopPct);
  };
  const handleArmTp = () => {
    setTpArmed(true);
    onSetTakeProfit?.(trade, tpPct);
  };

  return (
    <div className={`rounded-xl border bg-card transition-all duration-300 ${
      stopTriggered ? 'border-destructive/60 bg-destructive/5' :
      tpTriggered   ? 'border-accent/60 bg-accent/5' :
      urgent        ? 'border-chart-4/40' : 'border-border'
    }`}>
      {/* Top bar */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Badges */}
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${trade.asset === 'BTC' ? 'bg-chart-4/10 text-chart-4' : 'bg-primary/10 text-primary'}`}>
                {trade.asset}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${trade.side === 'yes' ? 'bg-accent/10 text-accent' : 'bg-destructive/10 text-destructive'}`}>
                {trade.side?.toUpperCase()}
              </span>
              <span className="text-[9px] font-mono text-muted-foreground bg-secondary/40 px-1.5 py-0.5 rounded">
                {trade.contract_type?.replace(/_/g, ' ')}
              </span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${trade.mode === 'live' ? 'bg-destructive/10 text-destructive' : 'bg-chart-4/10 text-chart-4'}`}>
                {trade.mode === 'live' ? '💰 LIVE' : '📄 PAPER'}
              </span>
              {urgent && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-chart-4/20 text-chart-4 animate-pulse">⏱ Settling soon</span>}
              {stopTriggered && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-destructive/20 text-destructive animate-pulse">🛑 STOP HIT</span>}
              {tpTriggered   && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-accent/20 text-accent animate-pulse">✅ TP HIT</span>}
              {stopArmed && !stopTriggered && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-destructive/30 text-destructive/70">SL {stopPct}%</span>}
              {tpArmed   && !tpTriggered   && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-accent/30 text-accent/70">TP +{tpPct}%</span>}
            </div>
            <p className="text-xs text-foreground font-medium truncate">{trade.market_title}</p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Live PnL */}
            <div className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold font-mono transition-all ${
              pnlPositive ? 'border-accent/30 bg-accent/10 text-accent' : 'border-destructive/30 bg-destructive/10 text-destructive'
            }`}>
              {pnlPositive ? '+' : ''}${pnl.toFixed(3)}
            </div>
            <button
              onClick={() => setExpanded(e => !e)}
              className="p-1.5 rounded-lg border border-border hover:bg-secondary text-muted-foreground transition-all"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => onCancel(trade)}
              disabled={cancelling}
              className="p-1.5 rounded-lg border border-border hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive text-muted-foreground transition-all"
              title="Cancel position"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Metrics row */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3 text-[10px] font-mono">
          <div>
            <p className="text-muted-foreground">Entry</p>
            <p className="text-foreground font-bold">{Math.round((trade.entry_price || 0) * 100)}¢</p>
          </div>
          <div>
            <p className="text-muted-foreground">Mark</p>
            <p className={`font-bold ${markPrice > (trade.entry_price || 0.5) ? 'text-accent' : 'text-destructive'}`}>{Math.round(markPrice * 100)}¢</p>
          </div>
          <div>
            <p className="text-muted-foreground">Size</p>
            <p className="text-foreground font-bold">${(trade.size_usdc || 0).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">PnL%</p>
            <p className={`font-bold ${pnlPositive ? 'text-accent' : 'text-destructive'}`}>{pnlPct.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-muted-foreground">Edge</p>
            <p className="text-accent font-bold">{(trade.edge_at_entry || 0).toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-muted-foreground flex items-center gap-1"><Clock className="w-2.5 h-2.5" />Age</p>
            <p className={`font-bold ${urgent ? 'text-chart-4' : 'text-foreground'}`}>{elapsed(trade.created_date)}</p>
          </div>
        </div>
      </div>

      {/* Expanded: trailing stop + TP controls */}
      {expanded && (
        <div className="border-t border-border/40 px-4 py-4 space-y-4">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Manual Override — Stop Loss &amp; Take Profit</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Trailing Stop */}
            <div className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Shield className="w-3.5 h-3.5 text-destructive" />
                <p className="text-xs font-semibold text-destructive">Trailing Stop Loss</p>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="text-muted-foreground">Trigger at</span>
                <span className="text-destructive font-bold">-{stopPct}%</span>
                <span className="text-muted-foreground">= ${(-(stopPct / 100) * (trade.size_usdc || 0)).toFixed(2)}</span>
              </div>
              <input
                type="range" min={5} max={80} step={5} value={stopPct}
                onChange={e => { setStopPct(parseInt(e.target.value)); setStopArmed(false); }}
                className="w-full h-1 accent-destructive"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleArmStop}
                  disabled={stopArmed}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all border ${
                    stopArmed
                      ? 'border-destructive/40 bg-destructive/10 text-destructive cursor-default'
                      : 'border-destructive/30 text-destructive hover:bg-destructive/10'
                  }`}
                >
                  {stopArmed ? `🛑 Armed at -${stopPct}%` : 'Arm Stop Loss'}
                </button>
                {stopArmed && (
                  <button onClick={() => setStopArmed(false)} className="px-2 rounded-lg border border-border text-muted-foreground hover:bg-secondary transition-all text-[10px]">
                    Disarm
                  </button>
                )}
              </div>
              {stopTriggered && (
                <div className="rounded-lg bg-destructive/20 text-destructive text-[10px] font-mono px-2 py-1.5 animate-pulse">
                  ⚠️ Stop triggered — cancel this position to exit
                </div>
              )}
            </div>

            {/* Take Profit */}
            <div className="space-y-2 rounded-lg border border-accent/20 bg-accent/5 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Target className="w-3.5 h-3.5 text-accent" />
                <p className="text-xs font-semibold text-accent">Take Profit</p>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="text-muted-foreground">Trigger at</span>
                <span className="text-accent font-bold">+{tpPct}%</span>
                <span className="text-muted-foreground">= +${((tpPct / 100) * (trade.size_usdc || 0)).toFixed(2)}</span>
              </div>
              <input
                type="range" min={10} max={200} step={10} value={tpPct}
                onChange={e => { setTpPct(parseInt(e.target.value)); setTpArmed(false); }}
                className="w-full h-1 accent-accent"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleArmTp}
                  disabled={tpArmed}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all border ${
                    tpArmed
                      ? 'border-accent/40 bg-accent/10 text-accent cursor-default'
                      : 'border-accent/30 text-accent hover:bg-accent/10'
                  }`}
                >
                  {tpArmed ? `✅ Armed at +${tpPct}%` : 'Arm Take Profit'}
                </button>
                {tpArmed && (
                  <button onClick={() => setTpArmed(false)} className="px-2 rounded-lg border border-border text-muted-foreground hover:bg-secondary transition-all text-[10px]">
                    Disarm
                  </button>
                )}
              </div>
              {tpTriggered && (
                <div className="rounded-lg bg-accent/20 text-accent text-[10px] font-mono px-2 py-1.5 animate-pulse">
                  🎯 Take profit triggered — cancel to lock gains
                </div>
              )}
            </div>
          </div>

          {trade.notes && (
            <p className="text-[9px] font-mono text-muted-foreground/60 truncate border-t border-border/20 pt-2">{trade.notes}</p>
          )}
        </div>
      )}
    </div>
  );
}