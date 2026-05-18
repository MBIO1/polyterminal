import React, { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format, subDays, startOfDay } from 'date-fns';

function buildDailyPnl(trades) {
  const today = startOfDay(new Date());
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = subDays(today, 29 - i);
    return { date: format(d, 'MMM d'), iso: format(d, 'yyyy-MM-dd'), pnl: 0, cumPnl: 0 };
  });

  for (const trade of trades) {
    if (!trade.exit_timestamp && !trade.trade_date) continue;
    const dateStr = trade.trade_date || format(new Date(trade.exit_timestamp), 'yyyy-MM-dd');
    const day = days.find(d => d.iso === dateStr);
    if (day) day.pnl += trade.net_pnl || 0;
  }

  let cum = 0;
  for (const day of days) {
    cum += day.pnl;
    day.cumPnl = parseFloat(cum.toFixed(2));
    day.pnl = parseFloat(day.pnl.toFixed(2));
  }

  return days;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const daily = payload.find(p => p.dataKey === 'pnl');
  const cum = payload.find(p => p.dataKey === 'cumPnl');
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs font-mono shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className={daily?.value >= 0 ? 'text-green-400' : 'text-red-400'}>
        Daily: ${daily?.value?.toFixed(2)}
      </p>
      <p className={cum?.value >= 0 ? 'text-primary' : 'text-destructive'}>
        Cumulative: ${cum?.value?.toFixed(2)}
      </p>
    </div>
  );
};

export default function DailyPnlChart({ trades = [] }) {
  const data = useMemo(() => buildDailyPnl(trades), [trades]);
  const totalPnl = data[data.length - 1]?.cumPnl ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Daily P&L — Last 30 Days</CardTitle>
          <span className={`text-sm font-mono font-bold ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} cumulative
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 14%)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }}
              tickLine={false}
              interval={4}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'hsl(215 14% 50%)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => `$${v}`}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="hsl(215 14% 30%)" strokeDasharray="4 4" />
            <Line
              type="monotone"
              dataKey="pnl"
              stroke="hsl(199 89% 48%)"
              strokeWidth={1.5}
              dot={false}
              name="Daily P&L"
            />
            <Line
              type="monotone"
              dataKey="cumPnl"
              stroke="hsl(142 71% 45%)"
              strokeWidth={2}
              dot={false}
              name="Cumulative"
              strokeDasharray="5 3"
            />
          </LineChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-2 text-xs font-mono text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-primary inline-block" /> Daily P&L
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-accent inline-block border-dashed border-t" /> Cumulative
          </span>
        </div>
      </CardContent>
    </Card>
  );
}