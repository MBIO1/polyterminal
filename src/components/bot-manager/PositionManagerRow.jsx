import React, { useState, useEffect, useRef } from 'react';
import { TrendingUp, TrendingDown, Shield, Target, Zap, X, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';

export default function PositionManagerRow({ position, onSell }) {
  const avgPrice = position.avg_price || 0;

  // Simulate live price drift around current_price
  const [livePrice, setLivePrice] = useState(position.current_price || avgPrice);
  const [trailingHigh, setTrailingHigh] = useState(position.current_price || avgPrice);
  const [stopPct, setStopPct] = useState(8);    // trailing stop %
  const [takePct, setTakePct] = useState(12);   // take-profit %
  const [armed, setArmed] = useState(true); // auto-arm on mount
  const [triggered, setTriggered] = useState(null); // 'stop' | 'tp'
  const intervalRef = useRef(null);
  const priceRef = useRef(livePrice);
  const highRef = useRef(trailingHigh);

  // Keep refs in sync
  useEffect(() => { priceRef.current = livePrice; }, [livePrice]);
  useEffect(() => { highRef.current = trailingHigh; }, [trailingHigh]);

  // Simulate price movement
  useEffect(() => {
    if (triggered) return;
    intervalRef.current = setInterval(() => {
      setLivePrice(prev => {
        const noise = prev * 0.008 * (Math.random() - 0.48);
        const next = Math.max(0.01, Math.min(0.99, prev + noise));
        setTrailingHigh(h => Math.max(h, next));
        return next;
      });
    }, 1500);
    return () => clearInterval(intervalRef.current);
  }, [triggered]);

  // Check thresholds when armed
  useEffect(() => {
    if (!armed || triggered) return;

    const stopTriggerPrice = highRef.current * (1 - stopPct / 100);
    const tpTriggerPrice = avgPrice * (1 + takePct / 100);

    if (livePrice <= stopTriggerPrice) {
      setTriggered('stop');
      clearInterval(intervalRef.current);
      onSell(position, livePrice, 'trailing_stop');
    } else if (livePrice >= tpTriggerPrice) {
      setTriggered('tp');
      clearInterval(intervalRef.current);
      onSell(position, livePrice, 'take_profit');
    }
  }, [livePrice, armed, stopPct, takePct, avgPrice, triggered, position, onSell]);

  const pnlPct = avgPrice > 0 ? ((livePrice - avgPrice) / avgPrice) * 100 : 0;
  const isProfit = pnlPct >= 0;
  const posValue = (position.shares || 0) * livePrice;
  const stopPrice = trailingHigh * (1 - stopPct / 100);
  const tpPrice = avgPrice * (1 + takePct / 100);
  const distToStop = ((livePrice - stopPrice) / livePrice * 100).toFixed(1);
  const distToTp = ((tpPrice - livePrice) / livePrice * 100).toFixed(1);

  return (
    <div className={`rounded-xl border bg-card p-5 space-y-4 transition-all duration-300 ${
      triggered === 'stop' ? 'border-destructive/50 bg-destructive/5' :
      triggered === 'tp'   ? 'border-accent/50 bg-accent/5' :
      armed                ? 'border-primary/30' :
                             'border-border hover:border-primary/20'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
            position.side === 'yes' ? 'bg-accent/10 text-accent' : 'bg-destructive/10 text-destructive'
          }`}>
            {position.side?.toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{position.market_title}</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {position.shares} shares · Entry {Math.round(avgPrice * 100)}¢
            </p>
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="text-base font-mono font-bold text-foreground">${posValue.toFixed(2)}</p>
          <div className={`flex items-center gap-1 justify-end text-xs font-mono ${isProfit ? 'text-accent' : 'text-destructive'}`}>
            {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Live price bar */}
      <div className="flex items-center gap-3 text-xs font-mono">
        <div className="flex-1 rounded-lg bg-secondary/50 border border-border px-3 py-2 flex justify-between items-center">
          <span className="text-muted-foreground">Live</span>
          <span className={`font-bold text-base ${isProfit ? 'text-accent' : 'text-destructive'}`}>
            {Math.round(livePrice * 100)}¢
          </span>
        </div>
        <div className="flex-1 rounded-lg bg-secondary/50 border border-border px-3 py-2 flex justify-between items-center">
          <span className="text-muted-foreground">Peak</span>
          <span className="font-bold text-chart-4">{Math.round(trailingHigh * 100)}¢</span>
        </div>
      </div>

      {/* Threshold controls */}
      <div className="space-y-3">
        {/* Trailing Stop */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-destructive" />
              <span className="text-xs font-medium text-muted-foreground">Trailing Stop</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-destructive font-bold">{stopPct}%</span>
              <span className="text-muted-foreground">→ floor {Math.round(stopPrice * 100)}¢</span>
              {armed && <span className="text-muted-foreground/60">(−{distToStop}% away)</span>}
            </div>
          </div>
          <Slider
            value={[stopPct]}
            onValueChange={([v]) => setStopPct(v)}
            min={2} max={40} step={1}
            disabled={!!triggered}
            className="py-1"
          />
        </div>

        {/* Take Profit */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <Target className="w-3.5 h-3.5 text-accent" />
              <span className="text-xs font-medium text-muted-foreground">Take Profit</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-accent font-bold">+{takePct}%</span>
              <span className="text-muted-foreground">→ target {Math.round(tpPrice * 100)}¢</span>
              {armed && <span className="text-muted-foreground/60">(+{distToTp}% away)</span>}
            </div>
          </div>
          <Slider
            value={[takePct]}
            onValueChange={([v]) => setTakePct(v)}
            min={5} max={100} step={5}
            disabled={!!triggered}
            className="py-1"
          />
        </div>
      </div>

      {/* Status + action */}
      {triggered ? (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-mono font-bold ${
          triggered === 'stop' ? 'bg-destructive/10 text-destructive border border-destructive/20' :
                                 'bg-accent/10 text-accent border border-accent/20'
        }`}>
          <CheckCircle2 className="w-4 h-4" />
          {triggered === 'stop'
            ? `⛔ Trailing stop triggered @ ${Math.round(livePrice * 100)}¢ — sell order fired`
            : `✅ Take profit triggered @ ${Math.round(livePrice * 100)}¢ — sell order fired`}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setArmed(a => !a)}
            className={`flex-1 font-mono text-xs ${
              armed
                ? 'bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20'
                : 'bg-secondary text-muted-foreground border border-border hover:bg-secondary/80'
            }`}
          >
            <Zap className="w-3 h-3 mr-1" />
            {armed ? '🤖 AUTO — Click to Pause' : '▶ Resume Auto'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { onSell(position, livePrice, 'manual'); setTriggered('stop'); }}
            className="border-destructive/30 text-destructive hover:bg-destructive/10 font-mono text-xs"
          >
            <X className="w-3 h-3 mr-1" /> Sell Now
          </Button>
        </div>
      )}
    </div>
  );
}