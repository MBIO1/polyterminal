import React from 'react';

// Tiny inline sparkline — no dependencies, draws with SVG.
export default function Sparkline({ values = [], width = 80, height = 24, stroke }) {
  if (!values.length) {
    return <svg width={width} height={height} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const last = values[values.length - 1];
  const color = stroke || (last >= 0 ? 'hsl(var(--accent))' : 'hsl(var(--destructive))');

  return (
    <svg width={width} height={height} className="inline-block align-middle">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}