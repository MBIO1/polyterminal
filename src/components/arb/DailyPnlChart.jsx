import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { format, parseISO, subDays, startOfDay } from 'date-fns';
import { computeNetPnl } from '@/lib/arbMath';
import EmptyState from './EmptyState';
import { TrendingUp } from 'lucide-react';

export default function DailyPnlChart({ trades = [], days = 30 }) {
  const data = useMemo(() => {
    const byDay = {};
    // seed last N days
    for (let i = days - 1; i >= 0; i--) {
      const d = format(subDays(startOfDay(new Date()), i), 'yyyy-MM-dd');
      byDay[d] = { date: d, pnl: 0 };
    }
    trades.forEach((t) => {
      if (t.status !== 'Closed') return;
      const raw = t.exit_timestamp || t.trade_date;
      if (!raw) return;
      const d = format(parseISO(raw), 'yyyy-MM-dd');
      if (!(d in byDay)) return;
      byDay[d].pnl += t.net_pnl ?? computeNetPnl(t);
    });
    // cumulative
    let cum = 0;
    return Object.values(byDay).map((row) => {
      cum += row.pnl;
      return { ...row, cumulative: cum, label: format(parseISO(row.date), 'MMM d') };
    });
  }, [trades, days]);

  const hasData = data.some((d) => d.pnl !== 0);
  if (!hasData) return <EmptyState title="No closed trades in this window" icon={TrendingUp} />;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.45} />
              <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
            </linearGradient>
          </defs>
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
            tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
            width={60}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
            }}
            labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
            formatter={(v, name) => [
              `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              name === 'cumulative' ? 'Cumulative' : 'Daily',
            ]}
          />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke="hsl(var(--chart-2))"
            strokeWidth={2}
            fill="url(#pnlFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}