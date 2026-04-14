import React, { useState } from 'react';
import { AlertTriangle, ShieldOff, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function KillSwitch({ active, dailyDrawdown, totalDrawdown, dailyHaltPct, killPct, onActivate, onReset }) {
  const [confirming, setConfirming] = useState(false);

  const dailyWarning = dailyDrawdown > dailyHaltPct * 0.7;
  const dailyHalt = dailyDrawdown >= dailyHaltPct;
  const totalKill = totalDrawdown >= killPct;

  const isHalted = active || dailyHalt || totalKill;

  return (
    <div className={`rounded-xl border p-4 transition-all ${
      isHalted
        ? 'border-destructive/50 bg-destructive/5'
        : dailyWarning
        ? 'border-yellow-500/30 bg-yellow-500/5'
        : 'border-border bg-card'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isHalted ? (
            <ShieldOff className="w-5 h-5 text-destructive" />
          ) : (
            <Shield className="w-5 h-5 text-accent" />
          )}
          <span className="text-sm font-semibold text-foreground">Kill Switch</span>
        </div>
        <div className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
          isHalted ? 'bg-destructive/20 text-destructive' : 'bg-accent/10 text-accent'
        }`}>
          {isHalted ? '⛔ HALTED' : '✓ ARMED'}
        </div>
      </div>

      <div className="space-y-2 mb-3">
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Daily Drawdown</span>
          <span className={`text-xs font-mono font-bold ${dailyHalt ? 'text-destructive' : dailyWarning ? 'text-yellow-400' : 'text-foreground'}`}>
            {dailyDrawdown.toFixed(1)}% / {dailyHaltPct}%
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${dailyHalt ? 'bg-destructive' : dailyWarning ? 'bg-yellow-400' : 'bg-accent'}`}
            style={{ width: `${Math.min(100, (dailyDrawdown / dailyHaltPct) * 100)}%` }}
          />
        </div>

        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Total Drawdown</span>
          <span className={`text-xs font-mono font-bold ${totalKill ? 'text-destructive' : 'text-foreground'}`}>
            {totalDrawdown.toFixed(1)}% / {killPct}%
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${totalKill ? 'bg-destructive' : 'bg-chart-4'}`}
            style={{ width: `${Math.min(100, (totalDrawdown / killPct) * 100)}%` }}
          />
        </div>
      </div>

      {!isHalted ? (
        confirming ? (
          <div className="space-y-2">
            <p className="text-xs text-destructive font-mono">Confirm emergency halt?</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" className="flex-1 text-xs" onClick={() => { onActivate(); setConfirming(false); }}>
                Halt Now
              </Button>
              <Button size="sm" variant="outline" className="flex-1 text-xs border-border" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="w-full text-xs border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => setConfirming(true)}>
            <AlertTriangle className="w-3 h-3 mr-1" /> Emergency Halt
          </Button>
        )
      ) : (
        <Button size="sm" variant="outline" className="w-full text-xs border-accent/30 text-accent hover:bg-accent/10" onClick={onReset}>
          <Shield className="w-3 h-3 mr-1" /> Reset & Resume
        </Button>
      )}
    </div>
  );
}