import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { TrendingUp, TrendingDown, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { fmtUSD, fmtBps } from '@/lib/arbMath';

const REFRESH_MS = 3_000;
const STALE_MS = 20_000;

function fmtPx(n) {
  if (n == null) return '—';
  return n >= 1000 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}` : `$${n.toFixed(2)}`;
}

function fmtFundingPct(r) {
  if (r == null) return '—';
  return (r * 100).toFixed(4) + '%';
}

export default function LiveTicker() {
  const [rows, setRows] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const res = await base44.functions.invoke('okxMarketScan', {});
      if (res.data?.error) throw new Error(res.data.error);
      setRows(res.data?.rows || []);
      setLastUpdate(Date.now());
      setError(null);
    } catch (e) {
      setError(e.message || 'fetch failed');
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_MS);
    const tid = setInterval(() => setTick(t => t + 1), 1000);
    return () => { clearInterval(id); clearInterval(tid); };
  }, [fetchData]);

  const ageMs = lastUpdate ? Date.now() - lastUpdate : null;
  const stale = ageMs != null && ageMs > STALE_MS;
  const ageLabel = ageMs == null ? '—' : ageMs < 60_000 ? `${Math.floor(ageMs / 1000)}s ago` : `${Math.floor(ageMs / 60_000)}m ago`;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-lg shadow-black/20">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">OKX Live Markets</span>
          {error ? (
            <span className="flex items-center gap-1 text-[10px] font-mono text-destructive">
              <WifiOff className="w-3 h-3" /> error
            </span>
          ) : stale ? (
            <span className="flex items-center gap-1 text-[10px] font-mono text-chart-4">
              <AlertTriangle className="w-3 h-3" /> stale
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-mono text-accent">
              <Wifi className="w-3 h-3" /> live
            </span>
          )}
        </div>
        <span className={`text-[10px] font-mono ${stale ? 'text-chart-4' : 'text-muted-foreground'}`}>
          {tick >= 0 && ageLabel}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
        {rows.length === 0 && !error ? (
          <div className="col-span-3 p-4 text-center text-xs font-mono text-muted-foreground">Loading…</div>
        ) : error && rows.length === 0 ? (
          <div className="col-span-3 p-4 text-center text-xs font-mono text-destructive">{error}</div>
        ) : (
          rows.map(r => {
            const pos = (r.basis_bps || 0) >= 0;
            const fundingPos = (r.funding_rate || 0) >= 0;
            return (
              <div key={r.asset} className="flex items-center justify-between px-4 py-3 gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{r.asset}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{r.spot_instrument}</span>
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                    Spot {fmtPx(r.spot_price)} · Perp {fmtPx(r.perp_price)}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-mono font-semibold inline-flex items-center gap-1 ${pos ? 'text-accent' : 'text-destructive'}`}>
                    {pos ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {fmtBps(r.basis_bps)}
                  </div>
                  <div className={`text-[10px] font-mono mt-0.5 ${fundingPos ? 'text-accent/80' : 'text-destructive/80'}`}>
                    fund {fmtFundingPct(r.funding_rate)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}