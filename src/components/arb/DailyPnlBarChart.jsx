import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import EmptyState from '@/components/arb/EmptyState';
import { BarChart3 } from 'lucide-react';
import { fmtUSD } from '@/lib/arbMath';

export default function DailyPnlBarChart({ rows = [], days = 30 }) {
  // rows is descending by date from parent; reverse for chart and trim
  const data = [...rows]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-days)
    .map(r => ({
      date: r.date,
      label: r.date?.slice(5), // MM-DD
      pnl: Number(r.pnl || 0),
    }));

  if (data.length === 0) {
    return <EmptyState title="No daily data yet" subtitle="Log trades to see daily performance." icon={BarChart3} />;
  }

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0))}
          />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
            labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
            formatter={(v) => [fmtUSD(v), 'Net PnL']}
          />
          <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.pnl >= 0 ? 'hsl(var(--accent))' : 'hsl(var(--destructive))'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}