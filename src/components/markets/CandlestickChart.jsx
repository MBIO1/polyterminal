import React, { useMemo } from 'react';
import {
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Bar,
  Cell,
  CartesianGrid,
  Scatter,
} from 'recharts';
import { formatCandleTime } from '@/lib/candlestickData';

// Custom candlestick bar shape
const CandleBar = (props) => {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;

  const { open, high, low, close } = payload;
  const isGreen = close >= open;
  const color = isGreen ? 'hsl(142, 71%, 45%)' : 'hsl(0, 72%, 55%)';

  // Normalize to pixel coords using chart scale
  const scale = props.scale;
  if (!scale) return null;

  const yHigh  = scale(high);
  const yLow   = scale(low);
  const yOpen  = scale(open);
  const yClose = scale(close);

  const bodyTop    = Math.min(yOpen, yClose);
  const bodyBottom = Math.max(yOpen, yClose);
  const bodyHeight = Math.max(1, bodyBottom - bodyTop);
  const cx = x + width / 2;
  const wickWidth = 1.5;

  return (
    <g>
      {/* High-Low wick */}
      <line x1={cx} y1={yHigh} x2={cx} y2={bodyTop} stroke={color} strokeWidth={wickWidth} />
      <line x1={cx} y1={bodyBottom} x2={cx} y2={yLow} stroke={color} strokeWidth={wickWidth} />
      {/* Body */}
      <rect
        x={x + 1}
        y={bodyTop}
        width={Math.max(2, width - 2)}
        height={bodyHeight}
        fill={isGreen ? color : color}
        fillOpacity={isGreen ? 0.85 : 0.85}
        rx={1}
      />
    </g>
  );
};

// Custom tooltip
const ChartTooltip = ({ active, payload, timeframe }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const isGreen = d.close >= d.open;

  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-[11px] font-mono space-y-1 min-w-[160px]">
      <p className="text-muted-foreground text-[10px]">{formatCandleTime(d.time, timeframe)}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <span className="text-muted-foreground">O</span><span className="text-foreground">{(d.open * 100).toFixed(1)}¢</span>
        <span className="text-muted-foreground">H</span><span className="text-accent">{(d.high * 100).toFixed(1)}¢</span>
        <span className="text-muted-foreground">L</span><span className="text-destructive">{(d.low * 100).toFixed(1)}¢</span>
        <span className={`font-bold ${isGreen ? 'text-accent' : 'text-destructive'}`}>C</span>
        <span className={`font-bold ${isGreen ? 'text-accent' : 'text-destructive'}`}>{(d.close * 100).toFixed(1)}¢</span>
      </div>
      <div className="border-t border-border/50 pt-1 mt-1">
        <span className="text-muted-foreground">Vol </span>
        <span className="text-foreground">{(d.volume / 1000).toFixed(0)}K</span>
      </div>
      {d.signal && (
        <div className={`mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-center ${
          d.signal === 'BUY_YES' ? 'bg-accent/20 text-accent' : 'bg-destructive/20 text-destructive'
        }`}>
          🤖 SIGNAL: {d.signal}
        </div>
      )}
      {d.take_profit && (
        <div className="mt-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-center bg-chart-4/20 text-chart-4">
          💰 TAKE PROFIT
        </div>
      )}
    </div>
  );
};

// Custom signal dot for scatter
const SignalDot = (props) => {
  const { cx, cy, payload } = props;
  if (!payload?.signal && !payload?.take_profit) return null;

  const isTP = !!payload.take_profit;
  const isYes = (payload.signal || payload.take_profit) === 'BUY_YES';

  const color = isTP
    ? 'hsl(45, 93%, 58%)'
    : isYes
    ? 'hsl(142, 71%, 45%)'
    : 'hsl(0, 72%, 55%)';

  const label = isTP ? '💰' : isYes ? '▲' : '▼';
  const yOffset = isTP ? -16 : isYes ? 10 : -10;

  return (
    <g>
      <circle cx={cx} cy={cy + yOffset} r={7} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={1.5} />
      <text x={cx} y={cy + yOffset + 4} textAnchor="middle" fontSize={8} fill={color} fontWeight="bold">
        {isTP ? '✓' : isYes ? '▲' : '▼'}
      </text>
    </g>
  );
};

export default function CandlestickChart({ candles, timeframe, currentPrice }) {
  if (!candles || candles.length === 0) return null;

  // Reduce candles to fit display (max 60)
  const display = candles.length > 60
    ? candles.filter((_, i) => i % Math.ceil(candles.length / 60) === 0)
    : candles;

  const priceMin = Math.min(...display.map(c => c.low)) * 0.98;
  const priceMax = Math.max(...display.map(c => c.high)) * 1.02;

  // For Recharts we use a ComposedChart with a custom Bar shape
  // We encode OHLC as a "range bar" from low to high, colored by close vs open
  const chartData = display.map((c, i) => ({
    ...c,
    index: i,
    label: formatCandleTime(c.time, timeframe),
    // encode body range for recharts
    bodyLow: Math.min(c.open, c.close),
    bodyHigh: Math.max(c.open, c.close),
    range: [c.low, c.high],
  }));

  const signalData = display.filter(c => c.signal || c.take_profit);

  return (
    <div className="w-full">
      {/* Main OHLC chart */}
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,14%,14%)" vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: 'hsl(215,14%,45%)', fontFamily: 'JetBrains Mono, monospace' }}
            interval={Math.floor(display.length / 6)}
          />
          <YAxis
            domain={[priceMin, priceMax]}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: 'hsl(215,14%,45%)', fontFamily: 'JetBrains Mono, monospace' }}
            tickFormatter={(v) => `${(v * 100).toFixed(0)}¢`}
            width={38}
          />
          <Tooltip content={<ChartTooltip timeframe={timeframe} />} />

          {/* Current price line */}
          <ReferenceLine
            y={currentPrice}
            stroke="hsl(199,89%,48%)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            label={{
              value: `${(currentPrice * 100).toFixed(0)}¢`,
              position: 'right',
              fill: 'hsl(199,89%,48%)',
              fontSize: 9,
              fontFamily: 'monospace',
            }}
          />

          {/* Wick: high-low range (thin line) */}
          <Bar dataKey="range" fill="transparent" stroke="transparent" barSize={1}>
            {chartData.map((entry, i) => {
              const isGreen = entry.close >= entry.open;
              return (
                <Cell
                  key={i}
                  stroke={isGreen ? 'hsl(142,71%,45%)' : 'hsl(0,72%,55%)'}
                  fill="transparent"
                />
              );
            })}
          </Bar>

          {/* Body: open-close range */}
          <Bar dataKey="bodyHigh" fill="transparent" barSize={6}>
            {chartData.map((entry, i) => {
              const isGreen = entry.close >= entry.open;
              return (
                <Cell
                  key={i}
                  fill={isGreen ? 'hsl(142,71%,45%)' : 'hsl(0,72%,55%)'}
                  fillOpacity={0.85}
                />
              );
            })}
          </Bar>

          {/* Signal scatter */}
          <Scatter
            data={signalData}
            dataKey="close"
            shape={<SignalDot />}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Volume bars */}
      <ResponsiveContainer width="100%" height={50}>
        <ComposedChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" hide />
          <YAxis hide />
          <Bar dataKey="volume" barSize={4} radius={[1, 1, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.close >= entry.open ? 'hsl(142,71%,45%)' : 'hsl(0,72%,55%)'}
                fillOpacity={0.4}
              />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}