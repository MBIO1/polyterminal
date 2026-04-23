import React, { useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine, Legend,
} from 'recharts';
import { format, subDays, startOfDay, parseISO } from 'date-fns';
import EmptyState from './EmptyState';
import { TrendingUp } from 'lucide-react';

export default function LivePnlChart({ trades = [], days = 14 }) {
  const data = useMemo(() => {
    const byDay = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(startOfDay(new Date()), i), 'yyyy-MM-dd');
      byDay[d] = { date: d, daily: 0, wins: 0, losses: 0 };
    }
    trades.forEach(t => {
      if (t.status !== 'Closed') return;
      const raw = t.exit_timestamp || t.trade_date;
      if (!raw) return;
      let d;
      try { d = format(parseISO(raw), 'yyyy-MM-dd'); } catch { return; }
      if (!(d in byDay)) return;
      const pnl = Number(t.net_pnl || 0);
      byDay[d].daily += pnl;
      pnl >= 0 ? byDay[d].wins++ : byDay[d].losses++;
    });
    let cum = 0;
    return Object.values(byDay).map(row => {
      cum += row.daily;
      return { ...row, cumulative: cum, label: format(parseISO(row.date), 'MMM d') };
    });
  }, [trades, days]);

  const hasData = data.some(d => d.daily !== 0);
  if (!hasData) return <EmptyState title="No closed trades yet" subtitle="Executed trades will appear here" icon={TrendingUp} />;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="hsl(var(--muted-foreground))"
            tick={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            tick={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `$${Math.round(v)}`}
            width={55}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
            }}
            formatter={(v, name) => [
              `$${Number(v).toFixed(2)}`,
              name === 'cumulative' ? 'Cumulative' : name === 'daily' ? 'Daily PnL' : name,
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'hsl(var(--muted-foreground))' }}
          />
          <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
          <Bar
            dataKey="daily"
            name="Daily PnL"
            fill="hsl(var(--chart-2))"
            opacity={0.7}
            radius={[2, 2, 0, 0]}
          />
          <Line
            type="monotone"
            dataKey="cumulative"
            name="Cumulative"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}