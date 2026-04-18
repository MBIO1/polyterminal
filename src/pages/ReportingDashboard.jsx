import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Download, TrendingUp, TrendingDown, Target, AlertCircle } from 'lucide-react';

export default function ReportingDashboard() {
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);

  const { data: trades = [] } = useQuery({
    queryKey: ['trades-reporting'],
    queryFn: () => base44.entities.BotTrade.list('-created_date', 500),
    refetchInterval: 5000,
  });

  const { data: configs = [] } = useQuery({
    queryKey: ['config-reporting'],
    queryFn: () => base44.entities.BotConfig.list(),
    refetchInterval: 5000,
  });

  // Group trades by week
  const weeklyData = useMemo(() => {
    const weeks = {};
    const settled = trades.filter(t => t.outcome !== 'pending' && t.outcome !== 'cancelled');

    settled.forEach(trade => {
      const date = new Date(trade.created_date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const weekKey = weekStart.toISOString().split('T')[0];

      if (!weeks[weekKey]) {
        weeks[weekKey] = {
          week: weekKey,
          trades: [],
          wins: 0,
          losses: 0,
          totalPnL: 0,
          maxDD: 0,
          startDate: weekStart,
        };
      }

      weeks[weekKey].trades.push(trade);
      if (trade.outcome === 'win') weeks[weekKey].wins++;
      else weeks[weekKey].losses++;
      weeks[weekKey].totalPnL += trade.pnl_usdc || 0;
    });

    // Calculate max drawdown per week
    Object.values(weeks).forEach(w => {
      let peak = 0;
      let runningBalance = configs[0]?.starting_balance || 1000;
      w.trades.forEach(t => {
        runningBalance += t.pnl_usdc || 0;
        peak = Math.max(peak, runningBalance);
      });
      w.maxDD = peak > 0 ? ((peak - (runningBalance)) / peak) * 100 : 0;
    });

    return Object.values(weeks).sort((a, b) => new Date(b.week) - new Date(a.week));
  }, [trades, configs]);

  const currentWeek = weeklyData[0];

  const handleGeneratePDF = async (week) => {
    setGeneratingPDF(true);
    try {
      const response = await base44.functions.invoke('generateWeeklyReport', {
        weekStart: week.week,
        trades: week.trades,
      });
      
      // Create a download link
      const link = document.createElement('a');
      link.href = response.data.file_url;
      link.download = `bot-report-${week.week}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Failed to generate PDF:', error);
    } finally {
      setGeneratingPDF(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-foreground">Performance Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">Weekly bot performance summaries with P&L analysis</p>
        </div>

        {/* Current Week Summary */}
        {currentWeek && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold text-muted-foreground">This Week Trades</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{currentWeek.trades.length}</div>
                <p className="text-xs text-muted-foreground mt-1">{currentWeek.wins}W / {currentWeek.losses}L</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold text-muted-foreground">Win Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {currentWeek.trades.length > 0 ? ((currentWeek.wins / currentWeek.trades.length) * 100).toFixed(1) : 0}%
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold text-muted-foreground">Realized P&L</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${currentWeek.totalPnL >= 0 ? 'text-accent' : 'text-destructive'}`}>
                  ${currentWeek.totalPnL.toFixed(2)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold text-muted-foreground">Max Drawdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-500">{currentWeek.maxDD.toFixed(1)}%</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Weekly Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Weekly Performance Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 font-semibold">Week Of</th>
                    <th className="text-center py-2 px-3 font-semibold">Trades</th>
                    <th className="text-center py-2 px-3 font-semibold">W/L</th>
                    <th className="text-center py-2 px-3 font-semibold">Win Rate</th>
                    <th className="text-right py-2 px-3 font-semibold">Realized P&L</th>
                    <th className="text-center py-2 px-3 font-semibold">Max DD</th>
                    <th className="text-center py-2 px-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyData.map((week, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-card/50">
                      <td className="py-3 px-3 text-muted-foreground">
                        {new Date(week.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className="text-center py-3 px-3">{week.trades.length}</td>
                      <td className="text-center py-3 px-3">
                        <span className="text-accent font-semibold">{week.wins}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-destructive font-semibold">{week.losses}</span>
                      </td>
                      <td className="text-center py-3 px-3">
                        {week.trades.length > 0 ? ((week.wins / week.trades.length) * 100).toFixed(1) : 0}%
                      </td>
                      <td className={`text-right py-3 px-3 font-mono font-semibold ${week.totalPnL >= 0 ? 'text-accent' : 'text-destructive'}`}>
                        ${week.totalPnL.toFixed(2)}
                      </td>
                      <td className="text-center py-3 px-3 text-orange-500">{week.maxDD.toFixed(1)}%</td>
                      <td className="text-center py-3 px-3">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleGeneratePDF(week)}
                          disabled={generatingPDF}
                          className="gap-1 text-xs"
                        >
                          <Download className="w-3 h-3" />
                          PDF
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Trends Chart */}
        {weeklyData.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Weekly P&L Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={weeklyData.slice().reverse()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="week"
                    tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    formatter={(value) => `$${value.toFixed(2)}`}
                  />
                  <Bar dataKey="totalPnL" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Win Rate Consistency */}
        {weeklyData.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Win Rate Consistency</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={weeklyData.slice().reverse().map(w => ({
                  ...w,
                  winRate: w.trades.length > 0 ? (w.wins / w.trades.length) * 100 : 0,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="week"
                    tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} label={{ value: '%', angle: -90, position: 'insideLeft' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    formatter={(value) => `${value.toFixed(1)}%`}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="winRate" stroke="hsl(var(--chart-1))" dot={{ fill: 'hsl(var(--chart-1))' }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}