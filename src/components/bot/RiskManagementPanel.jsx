import React, { useState, useEffect } from 'react';
import { ShieldAlert, Ban, ListOrdered, TrendingDown, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export default function RiskManagementPanel({ config, onUpdate, dailyDrawdown, openPositionCount }) {
  const maxDailyLoss = config?.max_daily_loss_pct ?? 10;
  const maxOpenPositions = config?.max_open_positions ?? 5;
  const autoHalt24h = config?.auto_halt_24h ?? true;

  // Check if 24h halt is currently active
  const haltUntil = config?.halt_until_ts || 0;
  const now = Date.now();
  const isIn24hHalt = haltUntil > now;
  const haltRemainingMin = isIn24hHalt ? Math.ceil((haltUntil - now) / 60000) : 0;

  const dailyBreached = dailyDrawdown >= maxDailyLoss;
  const posBreached = openPositionCount >= maxOpenPositions;

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-chart-4" />
        <h3 className="text-sm font-semibold text-foreground">Risk Management</h3>
      </div>

      {/* 24h halt alert */}
      {isIn24hHalt && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
          <Clock className="w-3.5 h-3.5 text-destructive shrink-0" />
          <p className="text-xs font-mono text-destructive">
            Auto-halted · resumes in {haltRemainingMin >= 60
              ? `${Math.floor(haltRemainingMin / 60)}h ${haltRemainingMin % 60}m`
              : `${haltRemainingMin}m`}
          </p>
        </div>
      )}

      {/* Max daily loss */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5 text-destructive" />
            <Label className="text-xs text-muted-foreground">Max Daily Loss</Label>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-mono font-bold ${dailyBreached ? 'text-destructive animate-pulse' : 'text-foreground'}`}>
              {maxDailyLoss}%
            </span>
            {dailyBreached && <AlertTriangle className="w-3 h-3 text-destructive" />}
          </div>
        </div>
        <Slider
          value={[maxDailyLoss]}
          onValueChange={([v]) => onUpdate({ max_daily_loss_pct: v })}
          min={1} max={50} step={1}
        />
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
          <span>Today: <span className={dailyBreached ? 'text-destructive font-bold' : 'text-foreground'}>{dailyDrawdown.toFixed(1)}%</span></span>
          <span>Limit: {maxDailyLoss}%</span>
        </div>
        {/* progress bar */}
        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${dailyBreached ? 'bg-destructive' : dailyDrawdown > maxDailyLoss * 0.7 ? 'bg-chart-4' : 'bg-accent'}`}
            style={{ width: `${Math.min(100, (dailyDrawdown / maxDailyLoss) * 100)}%` }}
          />
        </div>
      </div>

      {/* Max open positions */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <ListOrdered className="w-3.5 h-3.5 text-primary" />
            <Label className="text-xs text-muted-foreground">Max Open Positions</Label>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-mono font-bold ${posBreached ? 'text-chart-4 animate-pulse' : 'text-foreground'}`}>
              {openPositionCount} / {maxOpenPositions}
            </span>
            {posBreached && <Ban className="w-3 h-3 text-chart-4" />}
          </div>
        </div>
        <Slider
          value={[maxOpenPositions]}
          onValueChange={([v]) => onUpdate({ max_open_positions: v })}
          min={1} max={20} step={1}
        />
        {posBreached && (
          <p className="text-[10px] font-mono text-chart-4">⚠ Position limit reached — new entries blocked</p>
        )}
      </div>

      {/* 24h Auto-halt toggle */}
      <div className="flex items-center justify-between pt-1 border-t border-border">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <Label className="text-xs text-foreground">Auto-halt 24h on breach</Label>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground pl-5">
            Freezes trading for 24h when daily loss limit is hit
          </p>
        </div>
        <Switch
          checked={autoHalt24h}
          onCheckedChange={(v) => onUpdate({ auto_halt_24h: v })}
        />
      </div>

      {/* Status summary */}
      <div className={`rounded-lg px-3 py-2 flex items-center gap-2 text-xs font-mono ${
        isIn24hHalt || dailyBreached || posBreached
          ? 'bg-destructive/10 border border-destructive/20 text-destructive'
          : 'bg-accent/10 border border-accent/20 text-accent'
      }`}>
        {isIn24hHalt || dailyBreached || posBreached
          ? <><AlertTriangle className="w-3.5 h-3.5" /> Risk limit breached</>
          : <><CheckCircle2 className="w-3.5 h-3.5" /> Risk parameters OK</>
        }
      </div>
    </div>
  );
}