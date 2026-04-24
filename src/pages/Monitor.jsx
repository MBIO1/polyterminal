import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import Section from '@/components/arb/Section';
import StatTile from '@/components/arb/StatTile';
import StatusBadge from '@/components/arb/StatusBadge';
import EmptyState from '@/components/arb/EmptyState';
import { Activity, TrendingUp, AlertCircle, Zap } from 'lucide-react';

export default function Monitor() {
  // Live heartbeat
  const { data: heartbeats } = useQuery({
    queryKey: ['heartbeats'],
    queryFn: () => base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 10),
    refetchInterval: 5000,
    initialData: [],
  });

  // Live signals
  const { data: signals } = useQuery({
    queryKey: ['signals'],
    queryFn: () => base44.asServiceRole.entities.ArbSignal.filter({ status: { $in: ['detected', 'alerted'] } }, '-received_time', 20),
    refetchInterval: 3000,
    initialData: [],
  });

  // Live positions
  const { data: positions } = useQuery({
    queryKey: ['positions'],
    queryFn: () => base44.asServiceRole.entities.ArbLivePosition.filter({ status: 'Open' }, '-snapshot_time', 50),
    refetchInterval: 5000,
    initialData: [],
  });

  // Config
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: () => base44.asServiceRole.entities.ArbConfig.list('-created_date', 1),
    refetchInterval: 10000,
    initialData: [],
  });

  const latestHb = heartbeats?.[0];
  const cfg = config?.[0];
  const netDelta = positions.reduce((a, p) => a + (Number(p.net_delta_usd) || 0), 0);
  const marginUsed = positions.reduce((a, p) => a + (Number(p.margin_used) || 0), 0);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Live Monitor</h1>
          <p className="text-xs text-muted-foreground mt-1 font-mono">Real-time market data & execution tracking</p>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile 
            label="Posted" 
            value={latestHb?.posted || 0} 
            subLabel={`edge: ${latestHb?.best_edge_bps?.toFixed(1) || '—'} bps`}
            tone="primary"
          />
          <StatTile 
            label="Margin" 
            value={`${(marginUsed / 1000).toFixed(1)}k`} 
            subLabel={cfg ? `${((marginUsed / (cfg.total_capital * cfg.perp_collateral_pct)) * 100).toFixed(0)}%` : '—'}
            tone="warning"
          />
          <StatTile 
            label="Delta" 
            value={`$${Math.abs(netDelta).toFixed(0)}`} 
            subLabel={netDelta < 0 ? 'short' : 'long'}
            tone={Math.abs(netDelta) < 1000 ? 'success' : 'destructive'}
          />
          <StatTile 
            label="Positions" 
            value={positions.length} 
            subLabel="open"
            tone="secondary"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Signals */}
          <Section 
            title="Recent Signals" 
            subtitle={`${signals.length} pending`}
            className="h-fit"
          >
            {signals.length === 0 ? (
              <EmptyState title="No pending signals" icon={Zap} />
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {signals.slice(0, 10).map(s => (
                  <div key={s.id} className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50 text-xs">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-semibold text-foreground truncate">{s.pair}</p>
                      <p className="text-muted-foreground text-2xs">
                        {s.buy_exchange} → {s.sell_exchange} | {s.net_edge_bps?.toFixed(1)}bps
                      </p>
                    </div>
                    <span className="ml-2 whitespace-nowrap text-primary font-mono font-semibold">
                      {s.net_edge_bps?.toFixed(1)}bps
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Active Positions */}
          <Section 
            title="Open Positions" 
            subtitle={`${positions.length} active`}
            className="h-fit"
          >
            {positions.length === 0 ? (
              <EmptyState title="No open positions" icon={Activity} />
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {positions.slice(0, 8).map(p => (
                  <div key={p.id} className="flex items-center justify-between p-2 rounded bg-secondary/30 border border-border/50 text-xs">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono font-semibold text-foreground">{p.asset}</p>
                      <p className="text-muted-foreground text-2xs">
                        Δ: ${Math.abs(p.net_delta_usd || 0).toFixed(0)} | Margin: ${(p.margin_used || 0).toFixed(0)}
                      </p>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Heartbeat Detail */}
        {latestHb && (
          <Section 
            title="Latest Heartbeat" 
            subtitle={new Date(latestHb.snapshot_time).toLocaleTimeString()}
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="p-2 rounded bg-secondary/30">
                <p className="text-muted-foreground">Evaluations</p>
                <p className="font-mono font-semibold text-foreground">{latestHb.evaluations || 0}</p>
              </div>
              <div className="p-2 rounded bg-secondary/30">
                <p className="text-muted-foreground">Posted</p>
                <p className="font-mono font-semibold text-foreground text-primary">{latestHb.posted || 0}</p>
              </div>
              <div className="p-2 rounded bg-secondary/30">
                <p className="text-muted-foreground">Rejected (Edge)</p>
                <p className="font-mono font-semibold text-foreground">{latestHb.rejected_edge || 0}</p>
              </div>
              <div className="p-2 rounded bg-secondary/30">
                <p className="text-muted-foreground">Rejected (Liquidity)</p>
                <p className="font-mono font-semibold text-foreground">{latestHb.rejected_fillable || 0}</p>
              </div>
              <div className="p-2 rounded bg-secondary/30">
                <p className="text-muted-foreground">Best Edge</p>
                <p className="font-mono font-semibold text-foreground text-accent">{latestHb.best_edge_bps?.toFixed(1) || 0}bps</p>
              </div>
              <div className="p-2 rounded bg-secondary/30">
                <p className="text-muted-foreground">Best Pair</p>
                <p className="font-mono font-semibold text-foreground text-xs">{latestHb.best_edge_pair || '—'}</p>
              </div>
              <div className="p-2 rounded bg-secondary/30">
                <p className="text-muted-foreground">Fresh Books</p>
                <p className="font-mono font-semibold text-foreground text-xs">{latestHb.fresh_books?.slice(0, 20) || '—'}</p>
              </div>
              <div className="p-2 rounded bg-secondary/30">
                <p className="text-muted-foreground">Min Floor</p>
                <p className="font-mono font-semibold text-foreground">{latestHb.min_edge_floor_bps || 0}bps</p>
              </div>
            </div>
          </Section>
        )}

        {/* System Status */}
        {cfg && (
          <Section title="System Status">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${cfg.bot_running ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-muted-foreground">{cfg.bot_running ? 'Running' : 'Stopped'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${cfg.paper_trading ? 'bg-yellow-500' : 'bg-green-500'}`} />
                <span className="text-muted-foreground">{cfg.paper_trading ? 'Paper' : 'Live'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${cfg.kill_switch_active ? 'bg-red-500' : 'bg-green-500'}`} />
                <span className="text-muted-foreground">Kill Switch: {cfg.kill_switch_active ? 'ON' : 'off'}</span>
              </div>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}