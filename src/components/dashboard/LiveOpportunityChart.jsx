import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend, Area } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, TrendingUp, Zap } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const MAX_POINTS = 60; // last 60 data points

// Fetch current market prices from Bybit
async function fetchMarketPrices() {
  try {
    const [btcSpot, ethSpot] = await Promise.all([
      fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT').then(r => r.json()),
      fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=ETHUSDT').then(r => r.json()),
    ]);
    
    return {
      btc: parseFloat(btcSpot?.result?.list?.[0]?.lastPrice) || null,
      eth: parseFloat(ethSpot?.result?.list?.[0]?.lastPrice) || null,
    };
  } catch {
    return { btc: null, eth: null };
  }
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs font-mono shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }} className="flex items-center gap-1">
          {p.name}: {p.dataKey === 'signalEdge' ? `${p.value.toFixed(2)} bps` : `$${Number(p.value).toLocaleString()}`}
        </p>
      ))}
    </div>
  );
};

export default function LiveOpportunityChart() {
  const [data, setData] = useState([]);
  const [marketPrices, setMarketPrices] = useState({ btc: null, eth: null });
  const [loading, setLoading] = useState(true);
  const [asset, setAsset] = useState('BTC');
  const [recentSignals, setRecentSignals] = useState([]);
  const intervalRef = useRef(null);

  // Load initial signals
  const loadSignals = async () => {
    try {
      const signals = await base44.entities.ArbSignal.list('-created_date', 50);
      const now = Date.now();
      const recent = signals.filter(s => {
        const age = now - new Date(s.created_date).getTime();
        return age < 10 * 60 * 1000; // last 10 minutes
      });
      setRecentSignals(recent);
    } catch (error) {
      console.error('Failed to load signals:', error);
    }
  };

  // Fetch market data and build chart
  const tick = async () => {
    try {
      // Fetch current prices
      const prices = await fetchMarketPrices();
      setMarketPrices(prices);
      
      // Get current signal edge for selected asset
      const assetSignals = recentSignals.filter(s => s.asset === asset);
      const latestSignal = assetSignals.length > 0 ? assetSignals[0] : null;
      
      const newPoint = {
        time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        ts: Date.now(),
        price: asset === 'BTC' ? prices.btc : prices.eth,
        signalEdge: latestSignal ? latestSignal.net_edge_bps : 0,
        hasSignal: latestSignal !== null,
        signalStatus: latestSignal?.status,
      };

      setData(prev => {
        const next = [...prev, newPoint];
        return next.slice(-MAX_POINTS);
      });

      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSignals();
    tick();
    
    // Update every 2 seconds
    intervalRef.current = setInterval(tick, 2000);
    
    // Refresh signals every 15 seconds
    const signalInterval = setInterval(loadSignals, 15000);

    return () => {
      clearInterval(intervalRef.current);
      clearInterval(signalInterval);
    };
  }, [asset]);

  // Subscribe to real-time signal updates
  useEffect(() => {
    const unsubscribe = base44.entities.ArbSignal.subscribe((event) => {
      if (event.type === 'create') {
        loadSignals();
      }
    });
    return () => unsubscribe();
  }, []);

  const currentPrice = asset === 'BTC' ? marketPrices.btc : marketPrices.eth;
  const latestSignal = recentSignals.find(s => s.asset === asset);
  const currentEdge = latestSignal?.net_edge_bps || 0;

  // Calculate price range for Y-axis
  const validPrices = data.filter(d => d.price !== null).map(d => d.price);
  const priceMin = validPrices.length ? Math.min(...validPrices) * 0.999 : undefined;
  const priceMax = validPrices.length ? Math.max(...validPrices) * 1.001 : undefined;

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Live Opportunity Chart
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              Real-time
            </Badge>
          </div>

          {/* Asset selector */}
          <div className="flex gap-1">
            {['BTC', 'ETH'].map(a => (
              <button
                key={a}
                onClick={() => setAsset(a)}
                className={`px-3 py-1 text-xs font-mono font-semibold rounded-md border transition-colors ${
                  asset === a 
                    ? 'bg-primary text-primary-foreground border-primary' 
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* Current metrics */}
        <div className="flex flex-wrap gap-4 mt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">PRICE</span>
            <span className="text-sm font-bold font-mono">
              ${currentPrice ? currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '—'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">CURRENT EDGE</span>
            <span className={`text-sm font-bold font-mono ${currentEdge >= 3 ? 'text-green-400' : 'text-foreground'}`}>
              {currentEdge.toFixed(2)} bps
            </span>
            {currentEdge >= 3 && (
              <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30 border h-5">
                <Zap className="w-3 h-3 mr-1" />
                QUALIFIED
              </Badge>
            )}
          </div>
          {latestSignal && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono">LAST SIGNAL</span>
              <Badge className={`text-xs h-5 ${
                latestSignal.status === 'executed' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                latestSignal.status === 'rejected' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
              } border`}>
                {latestSignal.status.toUpperCase()}
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {loading && data.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            <Activity className="w-4 h-4 mr-2 animate-pulse" /> Collecting data...
          </div>
        ) : data.length < 3 ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
            <Activity className="w-4 h-4 mr-2 animate-pulse" /> Building chart...
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  interval={Math.floor(data.length / 6)}
                />
                <YAxis
                  yAxisId="left"
                  domain={[priceMin, priceMax]}
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                  tickFormatter={v => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[-5, 20]}
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tickFormatter={v => `${v} bps`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }}
                  formatter={(v) => (
                    <span style={{ 
                      color: v === 'price' ? '#0ea5e9' : v === 'signalEdge' ? '#a78bfa' : '#94a3b8', 
                      fontFamily: 'monospace' 
                    }}>
                      {v === 'price' ? `${asset} PRICE` : v === 'signalEdge' ? 'SIGNAL EDGE' : 'SIGNAL ZONE'}
                    </span>
                  )}
                />

                {/* Signal threshold zone */}
                <ReferenceLine 
                  yAxisId="right"
                  y={3} 
                  stroke="#22c55e" 
                  strokeDasharray="4 3" 
                  strokeWidth={1.5}
                  label={{ value: '3 bps floor', position: 'insideTopRight', fontSize: 9, fill: '#22c55e' }}
                />
                <ReferenceLine 
                  yAxisId="right"
                  y={0} 
                  stroke="hsl(var(--border))" 
                  strokeWidth={1} 
                />

                {/* Price line */}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="price"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={false}
                  name="price"
                  isAnimationActive={false}
                />

                {/* Signal edge line */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="signalEdge"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  dot={data.map(d => d.hasSignal ? { r: 4, fill: '#a78bfa' } : { r: 0 })}
                  name="signalEdge"
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}