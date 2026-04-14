import React from 'react';
import { Zap, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function OpportunityScanner({ opportunities, onExecute, botRunning, portfolioValue, maxPosPct }) {
  if (!opportunities || opportunities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <AlertCircle className="w-6 h-6 mb-2 opacity-40" />
        <p className="text-sm">Scanning for opportunities...</p>
        <p className="text-xs mt-1 font-mono">Lag threshold: 3pp | Edge: {'>'} 5%</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {opportunities.map((opp, i) => {
        const isHot = opp.edge_pct >= 8 && opp.confidence_score >= 85;
        const canExecute = opp.edge_pct >= 5 && opp.confidence_score >= 85 && opp.kelly_size_usdc <= portfolioValue * maxPosPct;

        return (
          <div
            key={i}
            className={`rounded-lg border p-3 transition-all ${
              isHot
                ? 'border-accent/40 bg-accent/5'
                : 'border-border/60 bg-secondary/30'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    opp.asset === 'BTC' ? 'bg-chart-4/10 text-chart-4' : 'bg-primary/10 text-primary'
                  }`}>{opp.asset}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{opp.contract_type?.replace('_', ' ').toUpperCase()}</span>
                  {isHot && <span className="text-[10px] font-mono font-bold text-accent">🔥 HOT</span>}
                </div>
                <p className="text-xs font-medium text-foreground">{opp.market_title}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-mono font-bold text-accent">{opp.edge_pct?.toFixed(1)}% edge</p>
                <p className="text-[10px] font-mono text-muted-foreground">{opp.confidence_score?.toFixed(0)}% conf</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[10px] font-mono mb-2">
              <div>
                <span className="text-muted-foreground block">Poly Price</span>
                <span className="text-foreground">{Math.round((opp.polymarket_price || 0) * 100)}¢</span>
              </div>
              <div>
                <span className="text-muted-foreground block">CEX Implied</span>
                <span className="text-foreground">{Math.round((opp.cex_implied_prob || 0) * 100)}¢</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Lag</span>
                <span className={opp.lag_pct >= 3 ? 'text-accent' : 'text-muted-foreground'}>
                  {opp.lag_pct?.toFixed(1)}pp
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-muted-foreground">
                Kelly size: ${opp.kelly_size_usdc?.toFixed(2)} ({opp.recommended_side?.toUpperCase()})
              </span>
              {botRunning && canExecute ? (
                <Button
                  size="sm"
                  className="h-6 text-[10px] font-mono bg-accent/20 hover:bg-accent/30 text-accent border border-accent/30 px-2"
                  onClick={() => onExecute(opp)}
                >
                  <Zap className="w-3 h-3 mr-1" /> Execute
                </Button>
              ) : (
                <span className={`text-[10px] font-mono ${canExecute ? 'text-accent/50' : 'text-muted-foreground/50'}`}>
                  {!canExecute ? (opp.confidence_score < 85 ? 'Low conf' : 'Below edge') : 'Bot paused'}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}