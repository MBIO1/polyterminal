import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, TrendingUp, TrendingDown } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const MAX_POINTS = 60; // last 60 ticks (~2 min at 2s)

async function fetchBybitPrices() {
  const [btcSpot, ethSpot, btcPerp, ethPerp] = await Promise.allSettled([
    fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT').then(r => r.json()),
    fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=ETHUSDT').then(r => r.json()),
    fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT').then(r => r.json()),
    fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=ETHUSDT').then(r => r.json()),
  ]);

  const get = (res) => {
    if (res.status !== 'fulfilled') return null;
    return parseFloat(res.value?.result?.list?.[0]?.lastPrice) || null;
  };

  return {
    btcSpot: get(btcSpot),
    ethSpot: get(ethSpot),
    btcPerp: get(btcPerp),
    ethPerp: get(ethPerp),
    time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    ts: Date.now(),
  };
}

const CustomTooltip = ({ active, payload, label, asset }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs font-mono shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: ${Number(p.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      ))}
    </div>
  );
};

function PriceTicker({ label, price, prevPrice, color }) {
  const up = price > prevPrice;
  const down = price < prevPrice;
  const diff = prevPrice ? ((price - prevPrice) / prevPrice * 100) : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground font-mono">{label}</span>
      <span className={`text-sm font-mono font-bold transition-colors ${up ? 'text-green-400' : down ? 'text-red-400' : 'text-foreground'}`}>
        ${price ? price.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}
      </span>
      {diff !== 0 && (
        <span className={`text-xs font-mono ${diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {diff >= 0 ? '+' : ''}{diff.toFixed(3)}%
        </span>
      )}
    </div>
  );
}

export default function LiveMarketChart({ activeTrades = [] }) {
  const [asset, setAsset] = useState('BTC');
  const [history, setHistory] = useState([]);
  const [latest, setLatest] = useState(null);
  const [prev, setPrev] = useState(null);
  const [recentSignals, setRecentSignals] = useState([]);
  const [connected, setConnected] = useState(false);
  const intervalRef = useRef(null);

  // Load recent signals for overlay
  const loadSignals = useCallback(async () => {
    try {
      const sigs = await base44.entities.ArbSignal.list('-received_time', 20);
      setRecentSignals(sigs.filter(s => {
        const age = Date.now() - new Date(s.received_time || s.created_date).getTime();
        return age < 10 * 60 * 1000; // last 10 min
      }));
    } catch {}
  }, []);

  const tick = useCallback(async () => {
    try {
      const prices = await fetchBybitPrices();
      setConnected(true);
      setPrev(prev => latest || prev);
      setLatest(prices);
      setHistory(prev => {
        const next = [...prev, prices];
        return next.slice(-MAX_POINTS);
      });
    } catch {
      setConnected(false);
    }
  }, [latest]);

  useEffect(() => {
    tick();
    loadSignals();
    intervalRef.current = setInterval(() => {
      tick();
    }, 2000);
    const sigInterval = setInterval(loadSignals, 15000);
    return () => {
      clearInterval(intervalRef.current);
      clearInterval(sigInterval);
    };
  }, []);

  // Build chart data normalized to % change from first point
  const spotKey = asset === 'BTC' ? 'btcSpot' : 'ethSpot';
  const perpKey = asset === 'BTC' ? 'btcPerp' : 'ethPerp';

  const baseSpot = history[0]?.[spotKey];
  const basePerp = history[0]?.[perpKey];

  const chartData = history.map(d => ({
    time: d.time,
    spot: d[spotKey],
    perp: d[perpKey],
    spotPct: baseSpot ? ((d[spotKey] - baseSpot) / baseSpot * 100) : 0,
    perpPct: basePerp ? ((d[perpKey] - basePerp) / basePerp * 100) : 0,
    spread: d[perpKey] && d[spotKey] ? ((d[perpKey] - d[spotKey]) / d[spotKey] * 10000) : 0, // bps
    ts: d.ts,
  }));

  const lastSpot = latest?.[spotKey];
  const lastPerp = latest?.[perpKey];
  const currentSpreadBps = lastSpot && lastPerp ? ((lastPerp - lastSpot) / lastSpot * 10000) : null;

  // Filter signals for current asset
  const assetSignals = recentSignals.filter(s => s.asset === asset || s.pair?.startsWith(asset));
  const activeAssetTrades = activeTrades.filter(t => t.asset === asset);

  const priceMin = chartData.length ? Math.min(...chartData.map(d => Math.min(d.spot || Infinity, d.perp || Infinity))) * 0.9999 : undefined;
  const priceMax = chartData.length ? Math.max(...chartData.map(d => Math.max(d.spot || 0, d.perp || 0))) * 1.0001 : undefined;

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Live Market Feed</CardTitle>
            <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${connected ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-red-500/30 bg-red-500/10 text-red-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
              {connected ? 'LIVE' : 'DISCONNECTED'}
            </div>
          </div>

          {/* Asset selector */}
          <div className="flex gap-1">
            {['BTC', 'ETH'].map(a => (
              <button
                key={a}
                onClick={() => setAsset(a)}
                className={`px-3 py-1 text-xs font-mono font-semibold rounded-md border transition-colors ${asset === a ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* Price tickers */}
        <div className="flex flex-wrap gap-4 mt-2">
          <PriceTicker label={`${asset} SPOT`} price={lastSpot} prevPrice={prev?.[spotKey]} color="#22c55e" />
          <PriceTicker label={`${asset} PERP`} price={lastPerp} prevPrice={prev?.[perpKey]} color="#0ea5e9" />
          {currentSpreadBps !== null && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono">SPREAD</span>
              <span className={`text-sm font-mono font-bold ${Math.abs(currentSpreadBps) >= 3 ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                {currentSpreadBps >= 0 ? '+' : ''}{currentSpreadBps.toFixed(2)} bps
              </span>
              {Math.abs(currentSpreadBps) >= 3 && (
                <Badge className="text-xs bg-yellow-500/20 text-yellow-400 border-yellow-500/30 border">SIGNAL ZONE</Badge>
              )}
            </div>
          )}
          {activeAssetTrades.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-primary animate-pulse" />
              <span className="text-xs text-primary font-mono">{activeAssetTrades.length} ACTIVE TRADE{activeAssetTrades.length > 1 ? 'S' : ''}</span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {chartData.length < 3 ? (
          <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">
            <Activity className="w-4 h-4 mr-2 animate-pulse" /> Collecting price data...
          </div>
        ) : (
          <>
            {/* Price chart */}
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    interval={Math.floor(chartData.length / 6)}
                  />
                  <YAxis
                    domain={[priceMin, priceMax]}
                    tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    width={70}
                    tickFormatter={v => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                  />
                  <Tooltip content={<CustomTooltip asset={asset} />} />
                  <Legend
                    wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }}
                    formatter={(v) => <span style={{ color: v === 'spot' ? '#22c55e' : '#0ea5e9', fontFamily: 'monospace' }}>{asset} {v.toUpperCase()}</span>}
                  />

                  {/* Active trade entry price lines */}
                  {activeAssetTrades.map((trade, i) => (
                    trade.spot_entry_px && (
                      <ReferenceLine
                        key={`trade-${i}`}
                        y={trade.spot_entry_px}
                        stroke="#f59e0b"
                        strokeDasharray="4 3"
                        strokeWidth={1.5}
                        label={{ value: `Entry $${trade.spot_entry_px?.toFixed(0)}`, position: 'insideTopRight', fontSize: 9, fill: '#f59e0b' }}
                      />
                    )
                  ))}

                  <Line type="monotone" dataKey="spot" stroke="#22c55e" strokeWidth={1.5} dot={false} name="spot" isAnimationActive={false} />
                  <Line type="monotone" dataKey="perp" stroke="#0ea5e9" strokeWidth={1.5} dot={false} name="perp" isAnimationActive={false} strokeDasharray="3 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Spread bps chart */}
            <div className="mt-2">
              <p className="text-xs text-muted-foreground font-mono mb-1">PERP–SPOT SPREAD (bps) — signal fires at ≥3 bps</p>
              <div className="h-20">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
                    <XAxis dataKey="time" hide />
                    <YAxis
                      tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={false}
                      width={32}
                      tickFormatter={v => `${v.toFixed(0)}`}
                    />
                    <Tooltip
                      formatter={(v) => [`${Number(v).toFixed(2)} bps`, 'Spread']}
                      labelFormatter={(l) => l}
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11 }}
                    />
                    <ReferenceLine y={3} stroke="#f59e0b" strokeDasharray="3 2" strokeWidth={1} label={{ value: '3 bps floor', position: 'insideTopRight', fontSize: 8, fill: '#f59e0b' }} />
                    <ReferenceLine y={-3} stroke="#f59e0b" strokeDasharray="3 2" strokeWidth={1} />
                    <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
                    <Line type="monotone" dataKey="spread" stroke="#a78bfa" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recent signals strip */}
            {assetSignals.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground font-mono mb-2">RECENT {asset} SIGNALS (last 10 min)</p>
                <div className="flex flex-wrap gap-2">
                  {assetSignals.slice(0, 6).map(s => {
                    const age = Math.round((Date.now() - new Date(s.received_time || s.created_date).getTime()) / 1000);
                    const statusColor = s.status === 'executed' ? 'text-green-400 border-green-500/30 bg-green-500/10'
                      : s.status === 'rejected' ? 'text-red-400 border-red-500/30 bg-red-500/10'
                      : 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10';
                    return (
                      <div key={s.id} className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-mono ${statusColor}`}>
                        {s.status === 'executed' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        <span>{s.net_edge_bps?.toFixed(1)} bps</span>
                        <span className="opacity-60">{age}s ago</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}