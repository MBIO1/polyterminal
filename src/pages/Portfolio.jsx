import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Wallet, TrendingUp, TrendingDown, PieChart } from 'lucide-react';
import { PieChart as RePieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import PositionRow from '@/components/portfolio/PositionRow';
import StatCard from '@/components/dashboard/StatCard';

const COLORS = ['hsl(199, 89%, 48%)', 'hsl(142, 71%, 45%)', 'hsl(0, 72%, 55%)', 'hsl(45, 93%, 58%)', 'hsl(280, 65%, 60%)'];

export default function Portfolio() {
  const { data: positions = [], isLoading } = useQuery({
    queryKey: ['positions'],
    queryFn: () => base44.entities.Position.list(),
  });

  const openPositions = positions.filter(p => p.status === 'open' || !p.status);
  const closedPositions = positions.filter(p => p.status === 'closed' || p.status === 'settled');

  const totalValue = openPositions.reduce((sum, p) => sum + (p.shares || 0) * (p.current_price || p.avg_price || 0), 0);
  const totalCost = openPositions.reduce((sum, p) => sum + (p.shares || 0) * (p.avg_price || 0), 0);
  const totalPnl = totalValue - totalCost;
  const pnlPercent = totalCost > 0 ? ((totalPnl / totalCost) * 100).toFixed(1) : 0;

  const yesPositions = openPositions.filter(p => p.side === 'yes');
  const noPositions = openPositions.filter(p => p.side === 'no');

  const pieData = [
    { name: 'YES', value: yesPositions.reduce((s, p) => s + (p.shares || 0) * (p.current_price || p.avg_price || 0), 0) },
    { name: 'NO', value: noPositions.reduce((s, p) => s + (p.shares || 0) * (p.current_price || p.avg_price || 0), 0) },
  ].filter(d => d.value > 0);

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Portfolio</h1>
        <p className="text-sm text-muted-foreground mt-1">Track your positions and performance</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Value" value={`$${totalValue.toFixed(2)}`} icon={Wallet} highlight />
        <StatCard label="Total P&L" value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`} change={Number(pnlPercent)} icon={totalPnl >= 0 ? TrendingUp : TrendingDown} />
        <StatCard label="Open Positions" value={openPositions.length} icon={PieChart} />
        <StatCard label="Closed" value={closedPositions.length} icon={PieChart} />
      </div>

      {/* Allocation + Positions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Allocation chart */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Allocation</h3>
          {pieData.length > 0 ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) =>
                      active && payload?.length ? (
                        <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
                          <p className="text-xs text-muted-foreground">{payload[0].name}</p>
                          <p className="text-sm font-mono font-bold text-foreground">${payload[0].value.toFixed(2)}</p>
                        </div>
                      ) : null
                    }
                  />
                </RePieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">No open positions</p>
          )}
          <div className="flex justify-center gap-6 mt-2">
            {pieData.map((d, i) => (
              <div key={d.name} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                <span className="text-xs text-muted-foreground">{d.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Position list */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Open Positions</h3>
          {isLoading ? (
            Array(3).fill(0).map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-card border border-border animate-pulse" />
            ))
          ) : openPositions.length > 0 ? (
            openPositions.map(pos => <PositionRow key={pos.id} position={pos} />)
          ) : (
            <div className="text-center py-12 text-muted-foreground text-sm rounded-xl border border-border bg-card">
              No open positions — start trading to build your portfolio
            </div>
          )}
        </div>
      </div>
    </div>
  );
}