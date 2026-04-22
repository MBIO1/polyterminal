import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Activity, TrendingUp, Gauge, CheckCircle2, AlertTriangle, Moon, XCircle } from 'lucide-react';
import Section from '@/components/arb/Section';

const VERDICT_CONFIG = {
  healthy: { icon: CheckCircle2, color: 'text-accent', bg: 'bg-accent/10 border-accent/30', label: 'HEALTHY', desc: 'Market is offering what the bot is firing on. Silence = correct.' },
  market_dead: { icon: Moon, color: 'text-muted-foreground', bg: 'bg-muted border-border', label: 'MARKET DEAD', desc: 'No meaningful basis anywhere. Bot is correctly idle — not broken.' },
  too_conservative: { icon: AlertTriangle, color: 'text-chart-4', bg: 'bg-chart-4/10 border-chart-4/30', label: 'TOO CONSERVATIVE', desc: 'Opportunities are piling up in 10–20 bps band. Consider lowering the floor.' },
  broken: { icon: XCircle, color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30', label: 'BROKEN', desc: 'Bot not seeing opportunities despite expected market activity.' },
  no_data: { icon: Activity, color: 'text-muted-foreground', bg: 'bg-muted border-border', label: 'NO DATA', desc: 'Waiting for first heartbeat from the droplet.' },
};

function Bar({ label, value, total, color = 'bg-primary' }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-baseline text-xs font-mono">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground">{value.toLocaleString()} <span className="text-muted-foreground">({pct.toFixed(1)}%)</span></span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

export default function BotProductivityPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await base44.functions.invoke('botProductivity', { window_hours: 24 });
        if (active) setData(res.data);
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 30000);
    return () => { active = false; clearInterval(id); };
  }, []);

  if (loading) return (
    <Section title="Bot Productivity" subtitle="What the market offered vs. what we fired on">
      <div className="text-center py-6 text-xs font-mono text-muted-foreground">Loading…</div>
    </Section>
  );

  if (error) return (
    <Section title="Bot Productivity" subtitle="What the market offered vs. what we fired on">
      <div className="text-center py-6 text-xs font-mono text-destructive">{error}</div>
    </Section>
  );

  if (!data || data.verdict === 'no_data') {
    const v = VERDICT_CONFIG.no_data;
    const Icon = v.icon;
    return (
      <Section title="Bot Productivity" subtitle="What the market offered vs. what we fired on">
        <div className={`rounded-lg border p-4 ${v.bg}`}>
          <div className="flex items-center gap-2">
            <Icon className={`w-4 h-4 ${v.color}`} />
            <span className={`text-xs font-semibold ${v.color}`}>{v.label}</span>
          </div>
          <p className="text-xs font-mono text-muted-foreground mt-2">
            {data?.message || v.desc}
          </p>
          <p className="text-[11px] font-mono text-muted-foreground mt-2">
            Update droplet <code>.env</code>: <code>BASE44_HEARTBEAT_URL=https://polytrade.base44.app/functions/ingestHeartbeat</code>, then redeploy bot.mjs.
          </p>
        </div>
      </Section>
    );
  }

  const dist = data.distribution || {};
  const total = (dist.b0_5 || 0) + (dist.b5_10 || 0) + (dist.b10_15 || 0) + (dist.b15_20 || 0) + (dist.b20_plus || 0);
  const verdict = VERDICT_CONFIG[data.verdict] || VERDICT_CONFIG.no_data;
  const VIcon = verdict.icon;

  return (
    <Section title="Bot Productivity" subtitle={`Last ${data.window_hours}h · ${data.heartbeat_count} heartbeats · ${(data.total_evaluations || 0).toLocaleString()} evaluations`}>
      {/* Verdict banner */}
      <div className={`rounded-lg border p-3 mb-4 ${verdict.bg}`}>
        <div className="flex items-center gap-2">
          <VIcon className={`w-4 h-4 ${verdict.color}`} />
          <span className={`text-xs font-bold tracking-wider ${verdict.color}`}>{verdict.label}</span>
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-1">{verdict.desc}</p>
      </div>

      {/* Peak edge across windows */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Peak 1h', value: data.peak_edge_bps_1h },
          { label: 'Peak 4h', value: data.peak_edge_bps_4h },
          { label: 'Peak 24h', value: data.peak_edge_bps_24h },
        ].map(p => (
          <div key={p.label} className="rounded-lg border border-border bg-secondary/40 p-3">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{p.label}</div>
            <div className={`text-lg font-bold font-mono mt-1 ${p.value >= 20 ? 'text-accent' : p.value >= 10 ? 'text-chart-4' : 'text-foreground'}`}>
              {p.value?.toFixed(2) || '0.00'} <span className="text-xs text-muted-foreground font-normal">bps</span>
            </div>
          </div>
        ))}
      </div>

      {/* Opportunity distribution */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Opportunity Distribution</span>
          <span className="text-[10px] font-mono text-muted-foreground">· {total.toLocaleString()} evals total</span>
        </div>
        <div className="space-y-2.5">
          <Bar label="< 5 bps (noise)" value={dist.b0_5 || 0} total={total} color="bg-muted-foreground/40" />
          <Bar label="5–10 bps" value={dist.b5_10 || 0} total={total} color="bg-primary/40" />
          <Bar label="10–15 bps" value={dist.b10_15 || 0} total={total} color="bg-primary/70" />
          <Bar label="15–20 bps (near-miss)" value={dist.b15_20 || 0} total={total} color="bg-chart-4" />
          <Bar label="20+ bps (fired)" value={dist.b20_plus || 0} total={total} color="bg-accent" />
        </div>
      </div>

      {/* Shadow PnL */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Gauge className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Shadow PnL — what if the floor were lower?</span>
        </div>
        <p className="text-[11px] font-mono text-muted-foreground mb-3">
          Estimated net bps assuming 50% edge retention (slippage + latency). Conservative.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead className="text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-2 px-2">Floor</th>
                <th className="text-right py-2 px-2">Opps</th>
                <th className="text-right py-2 px-2">Est bps/trade</th>
                <th className="text-right py-2 px-2">Est total bps</th>
              </tr>
            </thead>
            <tbody>
              {(data.shadow_pnl || []).map(row => (
                <tr key={row.floor_bps} className={`border-b border-border ${row.floor_bps === 20 ? 'bg-primary/5' : ''}`}>
                  <td className="py-2 px-2 text-foreground">
                    {row.floor_bps} bps {row.floor_bps === 20 && <span className="text-[10px] text-primary ml-1">(current)</span>}
                  </td>
                  <td className="py-2 px-2 text-right text-foreground">{row.opportunities.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right text-muted-foreground">{row.est_net_bps_per_trade}</td>
                  <td className={`py-2 px-2 text-right font-semibold ${row.est_total_bps > 0 ? 'text-accent' : 'text-muted-foreground'}`}>
                    {row.est_total_bps.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}