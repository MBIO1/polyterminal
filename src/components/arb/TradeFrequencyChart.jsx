import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';
import EmptyState from '@/components/arb/EmptyState';
import { BarChart3 } from 'lucide-react';

export default function TradeFrequencyChart({ data = [] }) {
  if (data.length === 0) {
    return <EmptyState title="No signal frequency yet" subtitle="Bot hasn't posted qualified signals in this window." icon={BarChart3} />;
  }

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
            labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
            formatter={(v, name) => [v, name === 'signals' ? 'Signals' : 'Executed']}
          />
          <Bar dataKey="signals" radius={[3, 3, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill="hsl(var(--chart-1))" />
            ))}
          </Bar>
          <Bar dataKey="executed" radius={[3, 3, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill="hsl(var(--accent))" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}