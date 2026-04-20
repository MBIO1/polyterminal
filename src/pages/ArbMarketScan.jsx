import React, { useEffect, useState, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { RefreshCw, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import Section from '@/components/arb/Section';
import StatTile from '@/components/arb/StatTile';
import EmptyState from '@/components/arb/EmptyState';
import Sparkline from '@/components/arb/Sparkline';
import BasisHistoryChart from '@/components/arb/BasisHistoryChart';
import { fmtUSD, fmtBps } from '@/lib/arbMath';

const REFRESH_MS = 10000;
const SPARK_MAX = 60;

function fmtFundingPct(r) {
  if (r === null || r === undefined) return '—';
  return (r * 100).toFixed(4) + '%';
}

function fmtCountdown(ms) {
  if (!ms) return '—';
  const diff = ms - Date.now();
  if (diff <= 0) return 'now';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export default function ArbMarketScan() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [sparks, setSparks] = useState({}); // { BTC: [bps, ...], ETH: [...], SOL: [...] }
  const [history, setHistory] = useState([]);
  const sparksRef = useRef({});

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await base44.functions.invoke('okxMarketScan', {});
      if (res.data?.error) throw new Error(res.data.error);
      setData(res.data);
      setLastUpdate(new Date());

      // append to in-memory sparklines
      const next = { ...sparksRef.current };
      for (const r of res.data?.rows || []) {
        if (r.basis_bps === null || r.basis_bps === undefined) continue;
        const arr = next[r.asset] ? [...next[r.asset], r.basis_bps] : [r.basis_bps];
        if (arr.length > SPARK_MAX) arr.shift();
        next[r.asset] = arr;
      }
      sparksRef.current = next;
      setSparks(next);
    } catch (e) {
      setError(e.message || 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const list = await base44.entities.ArbScanSnapshot.list('-snapshot_time', 500);
      setHistory(list);
    } catch (e) {
      // silent — history table may be empty before recorder runs
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchHistory();
    const id = setInterval(fetchData, REFRESH_MS);
    const hid = setInterval(fetchHistory, 60000);
    return () => { clearInterval(id); clearInterval(hid); };
  }, [fetchData, fetchHistory]);

  const rows = data?.rows || [];

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">OKX Market Scanner</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">
            Spot vs Perp basis & funding · auto-refresh every {REFRESH_MS / 1000}s
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-xs font-mono text-muted-foreground">
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-secondary hover:bg-secondary/70 text-xs font-mono disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="p-4 rounded-lg border border-destructive/40 bg-destructive/10 text-sm font-mono text-destructive">
          Error: {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {rows.map(r => (
          <StatTile
            key={r.asset}
            label={`${r.asset} Basis`}
            value={fmtBps(r.basis_bps)}
            sub={`${fmtUSD(r.basis_abs)} · funding ${fmtFundingPct(r.funding_rate)}`}
            tone={r.basis_bps >= 0 ? 'positive' : 'negative'}
          />
        ))}
      </div>

      <Section title="Live Markets" subtitle="OKX USDT spot & perpetual swaps">
        {loading && !data ? (
          <p className="text-center py-8 text-muted-foreground font-mono text-sm">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No market data" icon={Activity} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono whitespace-nowrap">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left py-2 px-2 font-medium">Asset</th>
                  <th className="text-right font-medium">Spot</th>
                  <th className="text-right font-medium">Perp</th>
                  <th className="text-right font-medium">Basis ($)</th>
                  <th className="text-right font-medium">Basis (bps)</th>
                  <th className="text-right font-medium">Trend</th>
                  <th className="text-right font-medium">Funding</th>
                  <th className="text-right font-medium">Next Funding</th>
                  <th className="text-right font-medium">24h Vol (USDT)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const pos = (r.basis_bps || 0) >= 0;
                  const fundingPos = (r.funding_rate || 0) >= 0;
                  return (
                    <tr key={r.asset} className="border-b border-border/30 hover:bg-secondary/40">
                      <td className="py-3 px-2">
                        <div className="font-semibold text-foreground">{r.asset}</div>
                        <div className="text-[10px] text-muted-foreground">{r.spot_instrument}</div>
                      </td>
                      <td className="text-right">
                        <div className="text-foreground">{fmtUSD(r.spot_price)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {fmtUSD(r.spot_bid)} / {fmtUSD(r.spot_ask)}
                        </div>
                      </td>
                      <td className="text-right">
                        <div className="text-foreground">{fmtUSD(r.perp_price)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {fmtUSD(r.perp_bid)} / {fmtUSD(r.perp_ask)}
                        </div>
                      </td>
                      <td className={`text-right ${pos ? 'text-accent' : 'text-destructive'}`}>
                        {fmtUSD(r.basis_abs)}
                      </td>
                      <td className={`text-right font-semibold ${pos ? 'text-accent' : 'text-destructive'}`}>
                        <span className="inline-flex items-center gap-1">
                          {pos ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {fmtBps(r.basis_bps)}
                        </span>
                      </td>
                      <td className="text-right">
                        <Sparkline values={sparks[r.asset] || []} />
                      </td>
                      <td className={`text-right ${fundingPos ? 'text-accent' : 'text-destructive'}`}>
                        {fmtFundingPct(r.funding_rate)}
                      </td>
                      <td className="text-right text-muted-foreground">
                        {fmtCountdown(r.next_funding_time)}
                      </td>
                      <td className="text-right text-muted-foreground">
                        {r.spot_vol_24h_usd ? fmtUSD(r.spot_vol_24h_usd, 0) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Basis History"
        subtitle={`Persisted snapshots · ${history.length} points loaded`}
      >
        <BasisHistoryChart snapshots={history} />
      </Section>

      <div className="text-[11px] font-mono text-muted-foreground leading-relaxed">
        <p><strong>Reading this:</strong> Basis &gt; 0 → perp trades above spot (long spot / short perp captures carry). Basis &lt; 0 → perp below spot (short spot / long perp).
        Funding is paid by longs to shorts when positive. Combine basis + funding to estimate the full carry edge.</p>
      </div>
    </div>
  );
}