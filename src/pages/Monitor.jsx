import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import Section from '@/components/arb/Section';
import StatTile from '@/components/arb/StatTile';
import StatusBadge from '@/components/arb/StatusBadge';
import EmptyState from '@/components/arb/EmptyState';
import { Zap, Activity } from 'lucide-react';

export default function Monitor() {
  const [data, setData] = useState({ hb: null, signals: [], positions: [], config: null, loading: true });

  useEffect(() => {
    const load = async () => {
      try {
        const [hbs, sigs, pos, cfg] = await Promise.all([
          base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 1),
          base44.asServiceRole.entities.ArbSignal.filter({ status: { $in: ['detected', 'alerted'] } }, '-received_time', 20),
          base44.asServiceRole.entities.ArbLivePosition.filter({ status: 'Open' }, '-snapshot_time', 100),
          base44.asServiceRole.entities.ArbConfig.list('-created_date', 1),
        ]);
        setData({
          hb: hbs?.[0] || null,
          signals: sigs || [],
          positions: pos || [],
          config: cfg?.[0] || null,
          loading: false,
        });
      } catch (e) {
        console.error('load error', e);
        setData(prev => ({ ...prev, loading: false }));
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  if (data.loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><div className="text-foreground">Loading...</div></div>;
  }

  const netDelta = data.positions.reduce((a, p) => a + (Number(p.net_delta_usd) || 0), 0);
  const marginUsed = data.positions.reduce((a, p) => a + (Number(p.margin_used) || 0), 0);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-foreground">Live Monitor</h1>
        
        <div className="grid grid-cols-4 gap-3">
          <StatTile label="Posted" value={data.hb?.posted || 0} tone="primary" />
          <StatTile label="Margin" value={`$${(marginUsed / 1000).toFixed(1)}k`} tone="warning" />
          <StatTile label="Delta" value={`$${Math.abs(netDelta).toFixed(0)}`} tone="secondary" />
          <StatTile label="Positions" value={data.positions.length} tone="secondary" />
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Section title="Signals" subtitle={`${data.signals.length} pending`}>
            {data.signals.length === 0 ? (
              <EmptyState title="No signals" icon={Zap} />
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {data.signals.slice(0, 10).map(s => (
                  <div key={s.id} className="p-2 rounded bg-secondary/30 text-xs">
                    <p className="font-mono text-foreground">{s.pair}</p>
                    <p className="text-muted-foreground text-2xs">{s.buy_exchange} → {s.sell_exchange} | {s.net_edge_bps?.toFixed(1)}bps</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Positions" subtitle={`${data.positions.length} open`}>
            {data.positions.length === 0 ? (
              <EmptyState title="No positions" icon={Activity} />
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {data.positions.slice(0, 8).map(p => (
                  <div key={p.id} className="p-2 rounded bg-secondary/30 text-xs flex justify-between items-center">
                    <div>
                      <p className="font-mono text-foreground">{p.asset}</p>
                      <p className="text-muted-foreground text-2xs">Δ: ${Math.abs(p.net_delta_usd || 0).toFixed(0)}</p>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {data.hb && (
          <Section title="Heartbeat" subtitle={new Date(data.hb.snapshot_time).toLocaleTimeString()}>
            <div className="grid grid-cols-4 gap-3 text-xs">
              <div className="p-2 rounded bg-secondary/30">
                <p className="text-muted-foreground">Evaluations</p>
                <p className="font-mono text-foreground">{data.hb.evaluations || 0}</p>
              </div>
              <div className="p-2 rounded bg-secondary/30">
                <p className="text-muted-foreground">Best Edge</p>
                <p className="font-mono text-accent">{data.hb.best_edge_bps?.toFixed(1) || 0}bps</p>
              </div>
              <div className="p-2 rounded bg-secondary/30">
                <p className="text-muted-foreground">Rejected (Edge)</p>
                <p className="font-mono text-foreground">{data.hb.rejected_edge || 0}</p>
              </div>
              <div className="p-2 rounded bg-secondary/30">
                <p className="text-muted-foreground">Rejected (Fill)</p>
                <p className="font-mono text-foreground">{data.hb.rejected_fillable || 0}</p>
              </div>
            </div>
          </Section>
        )}

        {data.config && (
          <Section title="System">
            <div className="flex gap-6 text-xs">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${data.config.bot_running ? 'bg-green-500' : 'bg-red-500'}`} />
                <span>{data.config.bot_running ? 'Running' : 'Stopped'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${data.config.paper_trading ? 'bg-yellow-500' : 'bg-green-500'}`} />
                <span>{data.config.paper_trading ? 'Paper' : 'Live'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${data.config.kill_switch_active ? 'bg-red-500' : 'bg-green-500'}`} />
                <span>Kill Switch: {data.config.kill_switch_active ? 'ON' : 'off'}</span>
              </div>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}