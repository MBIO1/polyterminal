import React, { useState } from 'react';
import { Play, Pause, Settings2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export default function BotControls({ config, onUpdate, running, onToggleRun, halted }) {
  const [showFlags, setShowFlags] = useState(false);

  const isPaperMode = config?.paper_trading !== false || !(config?.live_flag_1 && config?.live_flag_2 && config?.live_flag_3);
  const canGoLive = config?.live_flag_1 && config?.live_flag_2 && config?.live_flag_3;

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${running && !halted ? 'bg-accent animate-pulse' : halted ? 'bg-destructive' : 'bg-muted-foreground'}`} />
          <span className="text-sm font-semibold text-foreground">Bot Engine</span>
        </div>
        <div className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold flex items-center gap-1 ${
          isPaperMode ? 'bg-chart-4/10 text-chart-4' : 'bg-destructive/20 text-destructive'
        }`}>
          {isPaperMode ? '📄 PAPER' : '💰 LIVE'}
        </div>
      </div>

      {/* Start/Stop */}
      <Button
        onClick={onToggleRun}
        disabled={halted}
        className={`w-full font-mono ${
          running
            ? 'bg-secondary hover:bg-secondary/80 text-foreground border border-border'
            : 'bg-accent hover:bg-accent/90 text-accent-foreground'
        }`}
      >
        {running ? (
          <><Pause className="w-4 h-4 mr-2" /> Pause Bot</>
        ) : (
          <><Play className="w-4 h-4 mr-2" /> Start Bot</>
        )}
      </Button>

      {/* Mode */}
      <div className="space-y-3 pt-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Paper Trading Mode</Label>
          <Switch
            checked={isPaperMode}
            onCheckedChange={(val) => {
              if (!val) setShowFlags(true);
              else onUpdate({ paper_trading: true, live_flag_1: false, live_flag_2: false, live_flag_3: false });
            }}
          />
        </div>

        {showFlags && !canGoLive && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
              <span className="text-xs font-mono text-destructive font-bold">3 flags required for LIVE</span>
            </div>
            {[
              { key: 'live_flag_1', label: 'I understand real money is at risk' },
              { key: 'live_flag_2', label: 'USDC deposited on Polygon' },
              { key: 'live_flag_3', label: 'API key verified & tested' },
            ].map(f => (
              <div key={f.key} className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">{f.label}</span>
                <Switch
                  checked={config?.[f.key] || false}
                  onCheckedChange={(val) => onUpdate({ [f.key]: val })}
                />
              </div>
            ))}
            {canGoLive && (
              <Button
                size="sm"
                variant="destructive"
                className="w-full mt-1 text-xs font-mono"
                onClick={() => { onUpdate({ paper_trading: false }); setShowFlags(false); }}
              >
                Enable Live Trading
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}