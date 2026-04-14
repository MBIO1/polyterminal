// Generates realistic OHLC candlestick data for a prediction market price (0–1 range)
// Seeded by market id so each market has unique, consistent history

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Generates OHLC candles for a market
 * @param {string} marketId
 * @param {number} currentPrice  – yes_price (0-1)
 * @param {'1H'|'1D'|'1W'|'1M'} timeframe
 * @returns {Array<{time, open, high, low, close, volume, signal}>}
 */
export function generateCandles(marketId, currentPrice, timeframe) {
  const rand = seededRandom(hashStr(marketId + timeframe));

  const config = {
    '1H':  { candles: 60,  intervalMs: 60 * 1000,           label: '1m' },
    '1D':  { candles: 48,  intervalMs: 30 * 60 * 1000,      label: '30m' },
    '1W':  { candles: 56,  intervalMs: 3 * 60 * 60 * 1000,  label: '3h' },
    '1M':  { candles: 60,  intervalMs: 12 * 60 * 60 * 1000, label: '12h' },
  }[timeframe] || { candles: 48, intervalMs: 30 * 60 * 1000, label: '30m' };

  const now = Date.now();
  const startTime = now - config.candles * config.intervalMs;

  // Start from a price that trends toward currentPrice
  let price = Math.max(0.05, Math.min(0.95, currentPrice + (rand() - 0.5) * 0.3));
  const volatility = 0.015 + rand() * 0.02;

  const candles = [];

  for (let i = 0; i < config.candles; i++) {
    const t = startTime + i * config.intervalMs;
    const progress = i / config.candles;

    // Drift toward current price as we approach "now"
    const drift = (currentPrice - price) * 0.04;
    const noise = (rand() - 0.5) * volatility * 2;
    const open = price;
    price = Math.max(0.02, Math.min(0.98, price + drift + noise));
    const close = price;

    const range = Math.abs(close - open) + rand() * volatility;
    const high = Math.min(0.98, Math.max(open, close) + rand() * range * 0.6);
    const low  = Math.max(0.02, Math.min(open, close) - rand() * range * 0.6);
    const volume = Math.floor(5000 + rand() * 95000);

    candles.push({ time: t, open, high, low, close, volume });
  }

  // ── Inject bot signals ────────────────────────────────────────────────────
  // A signal fires when a significant price lag / momentum shift is detected
  const signaled = new Set();
  for (let i = 5; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const move = c.close - prev.close;
    const absMov = Math.abs(move);

    // Signal: momentum cross (simplified: >1.5% move in one candle that continues)
    if (absMov > 0.015 && !signaled.has(i)) {
      const type = move > 0 ? 'BUY_YES' : 'BUY_NO';
      // Only signal if next candle confirms direction (look-ahead for accuracy)
      const next = candles[i + 1];
      if (next) {
        const confirms = move > 0 ? next.close >= c.close : next.close <= c.close;
        if (confirms) {
          c.signal = type;
          // Mark take-profit candle (2–4 candles later when price reverts ≥50% of move)
          for (let j = i + 2; j < Math.min(i + 5, candles.length); j++) {
            const future = candles[j];
            const pnl = move > 0 ? future.close - c.close : c.close - future.close;
            if (pnl > absMov * 0.5) {
              future.take_profit = type;
              signaled.add(j);
              break;
            }
          }
          signaled.add(i);
        }
      }
    }
  }

  return candles;
}

export function formatCandleTime(ts, timeframe) {
  const d = new Date(ts);
  if (timeframe === '1H') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (timeframe === '1D') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (timeframe === '1W') return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}