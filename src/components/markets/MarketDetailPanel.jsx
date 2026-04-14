import React, { useState, useEffect, useRef } from 'react';
import { X, TrendingUp, TrendingDown, Clock, Zap, AlertTriangle, CheckCircle2, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import CandlestickChart from './CandlestickChart';
import { generateCandles } from '@/lib/candlestickData';
import { detectOpportunity, halfKelly } from '@/lib/botEngine';

const TIMEFRAMES = ['1H', '1D', '1W', '1M'];

const categoryIcons = {
  politics: '🏛️', crypto: '₿', sports: '⚽',
  entertainment: '🎬', science: '🔬', economics: '📈', world: '🌍',
};

export default function MarketDetailPanel({ market, onClose, onTrade }) {
  const [timeframe, setTimeframe] = useState('1D');
  const [candles, setCandles] = useState([]);
  const [liveSignals, setLiveSignals] = useState([]);
  const signalTimerRef = useRef(null);

  const yesPercent = Math.round((market.yes_price || 0) * 100);
  const noPercent = 100 - yesPercent;

  // ── Generate candles on market or timeframe change ────────────────────────
  useEffect(() => {
    const c = generateCandles(market.id, market.yes_price || 0.5, timeframe);
    setCandles(c);
  }, [market.id, market.yes_price, timeframe]);

  // ── Live signal detection — scans every 2s while panel open ──────────────
  useEffect(() => {
    const detect = () => {
      // Simulate a slight price fluctuation to detect arb
      const noise = (Math.random() - 0.5) * 0.04;
      const cexImplied = Math.max(0.02, Math.min(0.98, (market.yes_price || 0.5) + noise));
      const polyPrice = market.yes_price || 0.5;

      const opp = detectOpportunity(polyPrice, cexImplied, 2, 3);
      if (opp && opp.edge_pct >= 3) {
        const signal = {
          id: Date.now(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          side: opp.recommended_side,
          edge: opp.edge_pct,
          confidence: opp.confidence_score,
          lag: opp.lag_pct,
          cexImplied: Math.round(cexImplied * 100),
          polyPrice: Math.round(polyPrice * 100),
          kellySize: halfKelly(opp.edge_pct / 100, polyPrice, 1000, 0.08),
          type: opp.edge_pct >= 6 ? 'STRONG' : 'WEAK',
        };
        setLiveSignals(prev => [signal, ...prev].slice(0, 8));
      }
    };

    signalTimerRef.current = setInterval(detect, 2000);
    detect();
    return () => clearInterval(signalTimerRef.current);
  }, [market]);

  // Count signals and take-profits in current candles
  const signalCount = candles.filter(c => c.signal).length;
  const tpCount = candles.filter(c => c.take_profit).length;
  const winRate = signalCount > 0 ? Math.round((tpCount / signalCount) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto h-full w-full max-w-3xl bg-background border-l border-border flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border bg-card/50">
          <div className="flex items-start gap-3 flex-1 pr-4">
            <span className="text-2xl">{categoryIcons[market.category] || '📊'}</span>
            <div>
              <h2 className="text-base font-semibold text-foreground leading-snug">{market.title}</h2>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] font-mono border-border text-muted-foreground">
                  {market.category}
                </Badge>
                {market.end_date && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                    <Clock className="w-3 h-3" />
                    Resolves {format(new Date(market.end_date), 'MMM d, yyyy')}
                  </span>
                )}
                <span className="text-[10px] font-mono text-muted-foreground">
                  Vol ${(market.volume || 0) >= 1e6 ? `${((market.volume || 0) / 1e6).toFixed(1)}M` : `${((market.volume || 0) / 1000).toFixed(0)}K`}
                </span>
              </div>
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Prices */}
          <div className="grid grid-cols-2 gap-3 p-5 pb-0">
            <div className="rounded-xl bg-accent/5 border border-accent/20 p-4 text-center">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">YES</p>
              <p className="text-3xl font-mono font-bold text-accent">{yesPercent}¢</p>
              <p className="text-[10px] text-muted-foreground mt-1 font-mono">Implied {yesPercent}%</p>
            </div>
            <div className="rounded-xl bg-destructive/5 border border-destructive/20 p-4 text-center">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">NO</p>
              <p className="text-3xl font-mono font-bold text-destructive">{noPercent}¢</p>
              <p className="text-[10px] text-muted-foreground mt-1 font-mono">Implied {noPercent}%</p>
            </div>
          </div>

          {/* Chart section */}
          <div className="p-5">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Chart header + timeframe */}
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <Activity className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Price Chart</span>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono">
                    <span className="text-muted-foreground">Signals:</span>
                    <span className="text-accent font-bold">{signalCount}</span>
                    <span className="text-muted-foreground">│ TPs:</span>
                    <span className="text-chart-4 font-bold">{tpCount}</span>
                    <span className="text-muted-foreground">│ Win:</span>
                    <span className={`font-bold ${winRate >= 60 ? 'text-accent' : 'text-chart-4'}`}>{winRate}%</span>
                  </div>
                </div>
                <div className="flex bg-secondary rounded-lg p-0.5 gap-0.5">
                  {TIMEFRAMES.map(tf => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      className={`px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-all ${
                        timeframe === tf
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chart */}
              <div className="p-3 pb-0">
                <CandlestickChart
                  candles={candles}
                  timeframe={timeframe}
                  currentPrice={market.yes_price || 0.5}
                />
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 px-4 pb-3 pt-1 text-[10px] font-mono text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-accent inline-block" /> Bullish</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-destructive inline-block" /> Bearish</span>
                <span className="flex items-center gap-1.5"><span className="text-accent font-bold">▲</span> Bot Entry</span>
                <span className="flex items-center gap-1.5"><span className="text-chart-4 font-bold">✓</span> Take Profit</span>
                <span className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-primary inline-block" /> Current</span>
              </div>
            </div>
          </div>

          {/* Live Signals Feed */}
          <div className="px-5 pb-5">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                <h3 className="text-sm font-semibold text-foreground">Live Arb Signal Feed</h3>
                <span className="text-[10px] font-mono text-muted-foreground">CEX vs Polymarket lag detection</span>
              </div>

              {liveSignals.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4 font-mono">Scanning for lag opportunities...</p>
              ) : (
                <div className="space-y-2">
                  {liveSignals.map((sig) => (
                    <div
                      key={sig.id}
                      className={`rounded-lg border p-3 flex items-center gap-3 transition-all ${
                        sig.type === 'STRONG'
                          ? 'border-accent/30 bg-accent/5'
                          : 'border-border/50 bg-secondary/20'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        sig.side === 'yes' ? 'bg-accent/10' : 'bg-destructive/10'
                      }`}>
                        {sig.side === 'yes'
                          ? <TrendingUp className="w-4 h-4 text-accent" />
                          : <TrendingDown className="w-4 h-4 text-destructive" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-mono font-bold ${sig.side === 'yes' ? 'text-accent' : 'text-destructive'}`}>
                            BUY {sig.side.toUpperCase()}
                          </span>
                          {sig.type === 'STRONG' && (
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-accent/20 text-accent rounded">STRONG</span>
                          )}
                          <span className="text-[10px] font-mono text-muted-foreground">@ {sig.time}</span>
                        </div>
                        <div className="flex gap-3 mt-0.5 text-[10px] font-mono text-muted-foreground flex-wrap">
                          <span>Edge <span className="text-accent">{sig.edge.toFixed(1)}%</span></span>
                          <span>Lag <span className="text-foreground">{sig.lag.toFixed(1)}pp</span></span>
                          <span>Conf <span className="text-foreground">{sig.confidence.toFixed(0)}%</span></span>
                          <span>Poly <span className="text-foreground">{sig.polyPrice}¢</span></span>
                          <span>CEX <span className="text-foreground">{sig.cexImplied}¢</span></span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-mono font-bold text-foreground">${sig.kellySize.toFixed(2)}</p>
                        <p className="text-[9px] text-muted-foreground">½ Kelly</p>
                      </div>
                      {sig.type === 'STRONG' && (
                        <Button
                          size="sm"
                          className="h-7 text-[10px] font-mono bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30 shrink-0"
                          onClick={() => { onTrade(market, sig.side); }}
                        >
                          <Zap className="w-3 h-3 mr-1" /> Trade
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Trade buttons */}
          <div className="px-5 pb-6">
            <div className="grid grid-cols-2 gap-3">
              <Button
                className="bg-accent/10 text-accent hover:bg-accent/20 border border-accent/20 font-mono"
                onClick={() => onTrade(market, 'yes')}
              >
                <TrendingUp className="w-4 h-4 mr-2" /> Buy Yes {yesPercent}¢
              </Button>
              <Button
                className="bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 font-mono"
                onClick={() => onTrade(market, 'no')}
              >
                <TrendingDown className="w-4 h-4 mr-2" /> Buy No {noPercent}¢
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}