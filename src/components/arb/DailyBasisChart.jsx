import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';
import EmptyState from '@/components/arb/EmptyState';
import { LineChart as LineIcon } from 'lucide-react';

export default function DailyBasisChart({ data = [] }) {
  if (data.length === 0) {
    return <EmptyState title="No basis data yet" subtitle="Waiting for signals to accumulate." icon={LineIcon} />;
  }

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v.toFixed(0)}`}
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
            formatter={(v) => [`${Number(v).toFixed(2)} bps`, 'Avg Net Edge']}
          />
          <Line
            type="monotone"
            dataKey="avgEdge"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={{ r: 3, fill: 'hsl(var(--primary))' }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}