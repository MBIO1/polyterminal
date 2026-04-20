import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { TrendingUp, AlertTriangle, Activity, ArrowLeftRight, DollarSign, Percent } from 'lucide-react';
import Section from '@/components/arb/Section';
import StatTile from '@/components/arb/StatTile';
import StatusBadge from '@/components/arb/StatusBadge';
import EmptyState from '@/components/arb/EmptyState';
import DailyPnlChart from '@/components/arb/DailyPnlChart';
import { fmtUSD, fmtBps, sumBy, computeNetPnl } from '@/lib/arbMath';

export default function ArbDashboard() {
  const { data: config } = useQuery({
    queryKey: ['arb-config'],
    queryFn: async () => (await base44.entities.ArbConfig.list('-created_date', 1))[0],
  });
  const { data: trades = [] } = useQuery({
    queryKey: ['arb-trades'],
    queryFn: () => base44.entities.ArbTrade.list('-trade_date', 500),
  });
  const { data: positions = [] } = useQuery({
    queryKey: ['arb-positions'],
    queryFn: () => base44.entities.ArbLivePosition.list('-snapshot_time', 200),
  });
  const { data: exceptions = [] } = useQuery({
    queryKey: ['arb-exceptions'],
    queryFn: () => base44.entities.ArbException.list('-exception_date', 200),
  });

  const closed = trades.filter(t => t.status === 'Closed');
  const open = trades.filter(t => t.status === 'Open');
  const realizedPnl = closed.reduce((a, t) => a + (t.net_pnl ?? computeNetPnl(t)), 0);
  const totalFees = sumBy(closed, 'total_realized_fees');
  const totalFunding = sumBy(closed, 'realized_funding');
  const openPositions = positions.filter(p => p.status === 'Open');
  const netDelta = sumBy(openPositions, 'net_delta_usd');
  const openExceptions = exceptions.filter(e => e.status === 'Open').length;
  const totalCapital = config?.total_capital || 0;
  const returnPct = totalCapital ? (realizedPnl / totalCapital) * 100 : 0;
  const avgEdge = closed.length
    ? closed.reduce((a, t) => a + (t.net_pnl_bps || 0), 0) / closed.length
    : 0;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Arbitrage Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            {config?.paper_trading ? 'Paper Mode' : 'Live Mode'} · {trades.length} trades logged · {openPositions.length} open positions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${config?.bot_running ? 'bg-accent animate-pulse-glow' : 'bg-muted-foreground'}`} />
          <span className="text-xs font-mono text-muted-foreground">
            {config?.bot_running ? 'Bot Running' : 'Bot Idle'}
            {config?.kill_switch_active && ' · KILL SWITCH'}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Capital" value={fmtUSD(totalCapital, 0)} sub="Starting book" />
        <StatTile
          label="Realized PnL"
          value={fmtUSD(realizedPnl)}
          sub={`${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(3)}%`}
          tone={realizedPnl >= 0 ? 'positive' : 'negative'}
        />
        <StatTile label="Avg Edge" value={fmtBps(avgEdge)} sub={`${closed.length} closed`} tone="primary" />
        <StatTile label="Funding" value={fmtUSD(totalFunding)} sub="Realized" tone={totalFunding >= 0 ? 'positive' : 'negative'} />
        <StatTile label="Fees" value={fmtUSD(totalFees)} sub="All legs" tone="warn" />
        <StatTile
          label="Net Delta"
          value={fmtUSD(netDelta)}
          sub="Open positions"
          tone={Math.abs(netDelta) < (totalCapital * (config?.max_net_delta_drift_pct || 0.001)) ? 'positive' : 'negative'}
        />
      </div>

      <Section title="Daily Profit Trend" subtitle="Cumulative realized PnL · last 30 days">
        <DailyPnlChart trades={trades} days={30} />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section
          title="Open Positions"
          subtitle={`${openPositions.length} live`}
          action={<Link to="/positions" className="text-xs font-mono text-primary hover:underline">view all →</Link>}
        >
          {openPositions.length === 0 ? (
            <EmptyState title="No open positions" icon={Activity} />
          ) : (
            <div className="space-y-2">
              {openPositions.slice(0, 5).map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/30">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {p.asset} · <span className="font-mono text-xs text-muted-foreground">{p.spot_exchange} / {p.perp_exchange}</span>
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                      Spot {Number(p.spot_qty || 0).toFixed(4)} · Perp {Number(p.perp_qty || 0).toFixed(4)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-mono font-semibold ${Math.abs(p.net_delta_usd || 0) < 50 ? 'text-accent' : 'text-chart-4'}`}>
                      Δ {fmtUSD(p.net_delta_usd)}
                    </p>
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                      Margin {((p.margin_utilization_pct || 0) * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Recent Trades"
          subtitle={`${open.length} open · ${closed.length} closed`}
          action={<Link to="/trades" className="text-xs font-mono text-primary hover:underline">view all →</Link>}
        >
          {trades.length === 0 ? (
            <EmptyState title="No trades logged yet" icon={TrendingUp} />
          ) : (
            <div className="space-y-2">
              {trades.slice(0, 5).map(t => {
                const pnl = t.net_pnl ?? computeNetPnl(t);
                return (
                  <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/30">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-primary">{t.trade_id}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <p className="text-[11px] font-mono text-muted-foreground mt-1">
                        {t.asset} · {t.spot_exchange || '—'} ⇄ {t.perp_exchange || '—'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-mono font-semibold ${pnl >= 0 ? 'text-accent' : 'text-destructive'}`}>
                        {fmtUSD(pnl)}
                      </p>
                      <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                        {fmtBps(t.net_pnl_bps || 0)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section
          title="Open Exceptions"
          subtitle={openExceptions > 0 ? `${openExceptions} requiring attention` : 'All clear'}
          action={<Link to="/exceptions" className="text-xs font-mono text-primary hover:underline">view log →</Link>}
        >
          {openExceptions === 0 ? (
            <EmptyState title="No open exceptions" icon={AlertTriangle} />
          ) : (
            <div className="space-y-2">
              {exceptions.filter(e => e.status === 'Open').slice(0, 5).map(e => (
                <div key={e.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/30">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-primary">{e.exception_id}</span>
                      <StatusBadge status={e.severity} />
                    </div>
                    <p className="text-[11px] font-mono text-muted-foreground mt-1">{e.type} · {e.exchange || '—'}</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground max-w-[50%] truncate">{e.description}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Risk Limits" subtitle="Configured thresholds">
          <div className="space-y-3 text-xs font-mono">
            {[
              ['Max daily drawdown', `${((config?.max_daily_drawdown_pct || 0) * 100).toFixed(2)}%`, Percent],
              ['Max single trade loss', `${((config?.max_single_trade_loss_pct || 0) * 100).toFixed(3)}%`, DollarSign],
              ['Max net delta drift', `${((config?.max_net_delta_drift_pct || 0) * 100).toFixed(3)}%`, Activity],
              ['Max margin utilization', `${((config?.max_margin_utilization_pct || 0) * 100).toFixed(1)}%`, TrendingUp],
              ['BTC min edge', `${config?.btc_min_edge_bps || 0} bps`, ArrowLeftRight],
              ['ETH min edge', `${config?.eth_min_edge_bps || 0} bps`, ArrowLeftRight],
            ].map(([k, v, Icon]) => (
              <div key={k} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Icon className="w-3 h-3" /> {k}
                </span>
                <span className="text-foreground font-semibold">{v}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}