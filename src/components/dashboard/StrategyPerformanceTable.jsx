import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react';

const SORT_OPTIONS = ['pnl', 'trades', 'winRate'];

function pnlColor(val) {
  if (val > 0) return 'text-green-400';
  if (val < 0) return 'text-red-400';
  return 'text-muted-foreground';
}

export default function StrategyPerformanceTable({ trades = [] }) {
  const [sortBy, setSortBy] = useState('pnl');

  // Build per-strategy per-day rows
  const strategyMap = {};
  for (const t of trades) {
    const key = t.strategy || 'Unknown';
    if (!strategyMap[key]) {
      strategyMap[key] = { strategy: key, pnl: 0, trades: 0, wins: 0, losses: 0, avgBps: 0, bpsSum: 0 };
    }
    const s = strategyMap[key];
    s.pnl += t.net_pnl || 0;
    s.trades += 1;
    s.bpsSum += t.net_pnl_bps || 0;
    if ((t.net_pnl || 0) > 0) s.wins += 1;
    else if ((t.net_pnl || 0) < 0) s.losses += 1;
  }

  let rows = Object.values(strategyMap).map(s => ({
    ...s,
    winRate: s.trades > 0 ? (s.wins / s.trades) * 100 : 0,
    avgBps: s.trades > 0 ? s.bpsSum / s.trades : 0,
  }));

  rows.sort((a, b) => {
    if (sortBy === 'pnl') return b.pnl - a.pnl;
    if (sortBy === 'trades') return b.trades - a.trades;
    if (sortBy === 'winRate') return b.winRate - a.winRate;
    return 0;
  });

  const totalPnl = rows.reduce((s, r) => s + r.pnl, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          Strategy Performance
        </CardTitle>
        <div className="flex gap-1">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt}
              onClick={() => setSortBy(opt)}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                sortBy === opt
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt === 'pnl' ? 'P&L' : opt === 'trades' ? 'Volume' : 'Win %'}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm px-6 pb-4">No trade data yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                  <th className="text-left px-6 py-2 font-medium">Strategy</th>
                  <th className="text-right px-4 py-2 font-medium">Trades</th>
                  <th className="text-right px-4 py-2 font-medium">Wins</th>
                  <th className="text-right px-4 py-2 font-medium">Win %</th>
                  <th className="text-right px-4 py-2 font-medium">Avg bps</th>
                  <th className="text-right px-6 py-2 font-medium">Net P&L</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const pct = totalPnl !== 0 ? Math.abs(row.pnl / totalPnl) * 100 : 0;
                  return (
                    <tr key={row.strategy} className="border-b border-border/40 hover:bg-secondary/30 transition-colors">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <div className="font-medium truncate max-w-[180px]">{row.strategy}</div>
                          {/* mini bar */}
                          <div className="hidden md:block h-1.5 rounded-full bg-border overflow-hidden w-16">
                            <div
                              className={`h-full rounded-full ${row.pnl >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground font-mono">{row.trades}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        <span className="text-green-400">{row.wins}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-red-400">{row.losses}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Badge
                          variant="outline"
                          className={`font-mono text-xs ${row.winRate >= 60 ? 'border-green-500/40 text-green-400' : row.winRate >= 40 ? 'border-yellow-500/40 text-yellow-400' : 'border-red-500/40 text-red-400'}`}
                        >
                          {row.winRate.toFixed(0)}%
                        </Badge>
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-xs ${pnlColor(row.avgBps)}`}>
                        {row.avgBps >= 0 ? '+' : ''}{row.avgBps.toFixed(1)}
                      </td>
                      <td className={`px-6 py-3 text-right font-mono font-semibold ${pnlColor(row.pnl)}`}>
                        <span className="flex items-center justify-end gap-1">
                          {row.pnl > 0 ? <TrendingUp className="w-3 h-3" /> : row.pnl < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                          {row.pnl >= 0 ? '+' : ''}${row.pnl.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-secondary/20">
                  <td className="px-6 py-2 text-xs text-muted-foreground font-medium">TOTAL</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">
                    {rows.reduce((s, r) => s + r.trades, 0)}
                  </td>
                  <td colSpan={3} />
                  <td className={`px-6 py-2 text-right font-mono font-bold ${pnlColor(totalPnl)}`}>
                    {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}