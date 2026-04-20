import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

const COLORS = {
  BTC: 'hsl(45 93% 58%)',
  ETH: 'hsl(199 89% 48%)',
  SOL: 'hsl(280 65% 60%)',
};

export default function BasisHistoryChart({ snapshots = [] }) {
  const data = useMemo(() => {
    // Group by snapshot_time bucket (minute precision), then pivot assets into columns.
    const byTime = {};
    for (const s of snapshots) {
      if (!s.snapshot_time) continue;
      const t = new Date(s.snapshot_time);
      // Round to nearest minute for clean alignment
      const key = new Date(Math.floor(t.getTime() / 60000) * 60000).toISOString();
      if (!byTime[key]) byTime[key] = { t: key, ts: new Date(key).getTime() };
      byTime[key][s.asset] = Number(s.basis_bps);
    }
    return Object.values(byTime).sort((a, b) => a.ts - b.ts);
  }, [snapshots]);

  if (!data.length) {
    return (
      <p className="text-center py-8 text-muted-foreground font-mono text-xs">
        No history yet — snapshots will appear once the scheduled recorder runs.
      </p>
    );
  }

  return (
    <div className="w-full h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'hsl(var(--muted-foreground))' }}
            stroke="hsl(var(--border))"
          />
          <YAxis
            tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'hsl(var(--muted-foreground))' }}
            stroke="hsl(var(--border))"
            label={{ value: 'Basis (bps)', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '0.5rem',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
            }}
            labelFormatter={(ts) => new Date(ts).toLocaleString()}
            formatter={(v) => [Number(v).toFixed(2) + ' bps']}
          />
          <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
          {['BTC', 'ETH', 'SOL'].map((a) => (
            <Line
              key={a}
              type="monotone"
              dataKey={a}
              stroke={COLORS[a]}
              strokeWidth={1.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}