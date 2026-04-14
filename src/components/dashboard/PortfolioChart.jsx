import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const mockData = [
  { date: 'Jan', value: 1000 },
  { date: 'Feb', value: 1250 },
  { date: 'Mar', value: 1180 },
  { date: 'Apr', value: 1420 },
  { date: 'May', value: 1380 },
  { date: 'Jun', value: 1650 },
  { date: 'Jul', value: 1890 },
  { date: 'Aug', value: 2100 },
  { date: 'Sep', value: 1950 },
  { date: 'Oct', value: 2340 },
  { date: 'Nov', value: 2580 },
  { date: 'Dec', value: 2847 },
];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-mono font-bold text-foreground">${payload[0].value.toLocaleString()}</p>
    </div>
  );
};

export default function PortfolioChart() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Portfolio Value</h3>
          <p className="text-2xl font-bold font-mono text-foreground mt-1">$2,847.32</p>
        </div>
        <div className="flex items-center gap-1.5 bg-accent/10 px-2.5 py-1 rounded-full">
          <div className="w-1.5 h-1.5 rounded-full bg-accent" />
          <span className="text-xs font-mono font-medium text-accent">+184.7%</span>
        </div>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={mockData}>
            <defs>
              <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: 'hsl(215, 14%, 50%)' }}
            />
            <YAxis hide />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="hsl(199, 89%, 48%)"
              strokeWidth={2}
              fill="url(#portfolioGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}