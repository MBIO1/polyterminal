import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts';
import { AlertTriangle } from 'lucide-react';

export default function DrawdownGauge({ trades = [], config = null }) {
  const { currentDrawdown, maxAllowed, pct } = useMemo(() => {
    const maxAllowed = (config?.max_daily_drawdown_pct ?? 0.01) * 100; // convert decimal to %

    // Compute today's net PnL as proxy for daily drawdown
    const today = new Date().toISOString().slice(0, 10);
    const todayPnl = trades
      .filter(t => (t.trade_date || '').startsWith(today) || (t.exit_timestamp || '').startsWith(today))
      .reduce((s, t) => s + (t.net_pnl || 0), 0);

    const totalCapital = config?.total_capital ?? 100000;
    const currentDrawdown = todayPnl < 0 ? Math.abs(todayPnl / totalCapital) * 100 : 0;
    const pct = maxAllowed > 0 ? Math.min((currentDrawdown / maxAllowed) * 100, 100) : 0;

    return { currentDrawdown, maxAllowed, pct };
  }, [trades, config]);

  const color = pct >= 90 ? 'hsl(0 72% 55%)' : pct >= 60 ? 'hsl(45 93% 58%)' : 'hsl(142 71% 45%)';
  const statusLabel = pct >= 90 ? 'CRITICAL' : pct >= 60 ? 'WARNING' : 'OK';

  const data = [{ value: Math.max(pct, 2), fill: color }];

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          Daily Drawdown
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 flex flex-col items-center">
        <div className="w-full" style={{ height: 110 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              cx="50%"
              cy="95%"
              innerRadius="70%"
              outerRadius="100%"
              startAngle={180}
              endAngle={0}
              data={data}
              barSize={14}
            >
              <RadialBar
                dataKey="value"
                cornerRadius={6}
                background={{ fill: 'hsl(220 14% 12%)' }}
              />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        {/* Value labels — below the arc, no overlap */}
        <div className="flex flex-col items-center -mt-1">
          <span className="text-2xl font-bold font-mono leading-none" style={{ color }}>
            {currentDrawdown.toFixed(2)}%
          </span>
          <span className="text-[10px] font-mono text-muted-foreground mt-1">
            of {maxAllowed.toFixed(2)}% limit
          </span>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span
            className="text-xs font-mono font-semibold px-2 py-0.5 rounded"
            style={{ backgroundColor: `${color}22`, color }}
          >
            {statusLabel}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            {pct.toFixed(1)}% of limit used
          </span>
        </div>
      </CardContent>
    </Card>
  );
}