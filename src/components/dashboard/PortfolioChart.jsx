import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format } from 'date-fns';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-mono font-bold text-foreground">${payload[0].value?.toFixed(2)}</p>
    </div>
  );
};

export default function PortfolioChart() {
  const { data: configs = [] } = useQuery({ queryKey: ['bot-config'], queryFn: () => base44.entities.BotConfig.list() });
  const { data: trades = [], isLoading } = useQuery({
    queryKey: ['bot-trades-chart'],
    queryFn: () => base44.entities.BotTrade.list('-created_date', 500),
    refetchInterval: 30000,
  });

  const startingBalance = configs[0]?.starting_balance || 1000;

  const { chartData, totalPnl, pnlPct } = useMemo(() => {
    const sorted = [...trades].sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
    let cum = startingBalance;
    const chartData = [{ label: 'Start', value: startingBalance }];
    sorted.forEach(t => {
      cum += t.pnl_usdc || 0;
      chartData.push({
        label: t.created_date ? format(new Date(t.created_date), 'MMM d HH:mm') : '',
        value: Number(cum.toFixed(2)),
      });
    });
    const totalPnl = cum - startingBalance;
    const pnlPct = startingBalance > 0 ? ((totalPnl / startingBalance) * 100).toFixed(1) : '0.0';
    return { chartData, totalPnl, pnlPct };
  }, [trades, startingBalance]);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Portfolio Value</h3>
          <p className="text-2xl font-bold font-mono text-foreground mt-1">
            {isLoading ? '–' : `$${(startingBalance + (trades.reduce((s,t)=>s+(t.pnl_usdc||0),0))).toFixed(2)}`}
          </p>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${totalPnl >= 0 ? 'bg-accent/10' : 'bg-destructive/10'}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${totalPnl >= 0 ? 'bg-accent' : 'bg-destructive'}`} />
          <span className={`text-xs font-mono font-medium ${totalPnl >= 0 ? 'text-accent' : 'text-destructive'}`}>
            {totalPnl >= 0 ? '+' : ''}{pnlPct}%
          </span>
        </div>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(199,89%,48%)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(199,89%,48%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: 'hsl(215,14%,50%)' }} interval="preserveStartEnd" />
            <YAxis hide domain={['auto', 'auto']} />
            <ReferenceLine y={startingBalance} stroke="hsl(215 14% 25%)" strokeDasharray="4 2" />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="value" stroke="hsl(199,89%,48%)" strokeWidth={2} fill="url(#portfolioGradient)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {trades.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground text-center mt-2">No bot trades yet — start the bot to populate chart</p>
      )}
    </div>
  );
}