import React, { useMemo } from 'react';

const CONTRACTS = ['BTC 5m ↑', 'BTC 5m ↓', 'BTC 15m ↑', 'BTC 15m ↓', 'ETH 5m ↑', 'ETH 5m ↓', 'ETH 15m ↑', 'ETH 15m ↓'];
const CONTRACT_KEYS = ['BTC_5min_up', 'BTC_5min_down', 'BTC_15min_up', 'BTC_15min_down', 'ETH_5min_up', 'ETH_5min_down', 'ETH_15min_up', 'ETH_15min_down'];

function getKey(t) {
  return `${t.asset}_${t.contract_type}`;
}

function heatColor(val) {
  // val: -1 (deep red) to +1 (deep green), 0 = neutral gray
  if (val === null) return 'hsl(220 14% 12%)';
  if (val > 0.5)  return `hsl(142 71% ${30 + val * 20}% / 0.9)`;
  if (val > 0.15) return `hsl(142 71% 35% / ${0.3 + val})`;
  if (val > -0.15) return 'hsl(220 14% 18%)';
  if (val > -0.5) return `hsl(0 72% 40% / ${0.3 + Math.abs(val)})`;
  return `hsl(0 72% ${25 + Math.abs(val) * 20}% / 0.9)`;
}

export default function CorrelationHeatmap({ trades }) {
  // Per-contract stats
  const stats = useMemo(() => {
    const map = {};
    CONTRACT_KEYS.forEach(k => { map[k] = { wins: 0, total: 0, pnl: 0, edges: [] }; });
    trades.forEach(t => {
      const k = getKey(t);
      if (!map[k]) return;
      if (t.outcome === 'win' || t.outcome === 'loss') {
        map[k].total++;
        if (t.outcome === 'win') map[k].wins++;
      }
      map[k].pnl += t.pnl_usdc || 0;
      if (t.edge_at_entry) map[k].edges.push(t.edge_at_entry);
    });
    return map;
  }, [trades]);

  // Correlation matrix: row × col = pnl co-movement score
  // We use win-rate delta from mean as a proxy for correlation
  const mean = useMemo(() => {
    const vals = CONTRACT_KEYS.map(k => stats[k].total > 0 ? stats[k].wins / stats[k].total : null).filter(v => v !== null);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.5;
  }, [stats]);

  const wrDelta = useMemo(() =>
    CONTRACT_KEYS.map(k => stats[k].total > 0 ? (stats[k].wins / stats[k].total) - mean : null),
    [stats, mean]
  );

  // Similarity score between two contracts (both positive / both negative = correlated)
  function similarity(i, j) {
    const a = wrDelta[i], b = wrDelta[j];
    if (a === null || b === null) return null;
    if (i === j) return 1;
    // product of deltas normalized
    const product = a * b;
    return Math.max(-1, Math.min(1, product * 20));
  }

  // Best performing contracts
  const ranked = CONTRACT_KEYS.map((k, i) => ({
    label: CONTRACTS[i], key: k,
    wr: stats[k].total > 0 ? stats[k].wins / stats[k].total * 100 : null,
    pnl: stats[k].pnl,
    avgEdge: stats[k].edges.length > 0 ? stats[k].edges.reduce((a,b) => a+b,0) / stats[k].edges.length : 0,
    total: stats[k].total,
  })).sort((a, b) => (b.pnl) - (a.pnl));

  if (trades.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No trade data yet — run the bot to populate the heatmap
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Heatmap grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          {/* Column headers */}
          <div className="flex items-center gap-0 mb-1 ml-[88px]">
            {CONTRACTS.map(c => (
              <div key={c} className="w-[60px] flex-shrink-0 text-center text-[9px] font-mono text-muted-foreground leading-tight px-0.5">
                {c}
              </div>
            ))}
          </div>
          {/* Rows */}
          {CONTRACTS.map((rowLabel, i) => (
            <div key={rowLabel} className="flex items-center gap-0 mb-0.5">
              <div className="w-[88px] flex-shrink-0 text-[9px] font-mono text-muted-foreground text-right pr-2 leading-tight">{rowLabel}</div>
              {CONTRACTS.map((_, j) => {
                const val = similarity(i, j);
                const isOwn = i === j;
                const wr = stats[CONTRACT_KEYS[i]].total > 0
                  ? (stats[CONTRACT_KEYS[i]].wins / stats[CONTRACT_KEYS[i]].total * 100).toFixed(0)
                  : null;
                return (
                  <div
                    key={j}
                    title={isOwn ? `${rowLabel}\nWR: ${wr ?? '–'}%\nP&L: $${stats[CONTRACT_KEYS[i]].pnl.toFixed(2)}`
                      : `${rowLabel} × ${CONTRACTS[j]}\nCorrelation: ${val !== null ? val.toFixed(2) : '–'}`}
                    className="w-[60px] h-[44px] flex-shrink-0 rounded-sm mx-0.5 flex items-center justify-center cursor-default transition-transform hover:scale-105"
                    style={{ background: isOwn
                      ? (wr !== null
                          ? (Number(wr) >= 50 ? 'hsl(142 71% 30% / 0.85)' : 'hsl(0 72% 32% / 0.85)')
                          : 'hsl(220 14% 18%)')
                      : heatColor(val)
                    }}
                  >
                    <span className="text-[9px] font-mono font-bold text-foreground/80">
                      {isOwn ? (wr !== null ? `${wr}%` : '–') : (val !== null ? val.toFixed(2) : '–')}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 ml-[88px] text-[9px] font-mono text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(0 72% 35% / 0.8)' }} />
              Inverse
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(220 14% 18%)' }} />
              Neutral
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(142 71% 33% / 0.8)' }} />
              Correlated
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm border border-border" />
              Diagonal = own WR
            </div>
          </div>
        </div>
      </div>

      {/* Best-edge leaderboard */}
      <div>
        <h4 className="text-xs font-mono font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Best-Edge Leaderboard</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {ranked.slice(0, 4).map((r, rank) => (
            <div key={r.key} className={`rounded-lg border p-3 ${
              rank === 0 ? 'border-accent/50 bg-accent/5' : 'border-border bg-secondary/30'
            }`}>
              {rank === 0 && (
                <span className="text-[9px] font-mono font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded mb-2 inline-block">🏆 TOP EDGE</span>
              )}
              <p className="text-sm font-mono font-bold text-foreground">{r.label}</p>
              <p className={`text-lg font-bold font-mono mt-1 ${r.pnl >= 0 ? 'text-accent' : 'text-destructive'}`}>
                {r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(2)}
              </p>
              <div className="mt-2 space-y-0.5 text-[10px] font-mono text-muted-foreground">
                <div className="flex justify-between">
                  <span>Win Rate</span>
                  <span className={r.wr !== null ? (r.wr >= 50 ? 'text-accent' : 'text-destructive') : 'text-muted-foreground'}>
                    {r.wr !== null ? `${r.wr.toFixed(0)}%` : '–'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Avg Edge</span>
                  <span className="text-primary">{r.avgEdge.toFixed(1)}pp</span>
                </div>
                <div className="flex justify-between">
                  <span>Trades</span>
                  <span>{r.total}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}