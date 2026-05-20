/**
 * Arbitrage Bot Runner — connects the detection engine to Base44
 * Posts qualified signals to Base44 ingestSignal endpoint
 */

import ArbitrageEngine from './bot.mjs';

// Configuration from environment
const BASE44_INGEST_URL = process.env.BASE44_INGEST_URL || 'https://polytrade.base44.app/functions/ingestSignal';
const BOT_SECRET = process.env.BOT_SECRET || process.env.DROPLET_SECRET || '';
// LOWERED gates so we can SEE bot reaction/performance (was 20 bps / $500 / 60% confidence)
const MIN_NET_EDGE_BPS = parseInt(process.env.MIN_NET_EDGE_BPS) || 8;   // 8 bps = 0.08% (was 20)
const MIN_FILLABLE_USD = parseInt(process.env.MIN_FILLABLE_USD) || 200; // (was 500)
const PAIRS = (process.env.PAIRS || 'BTC-USDT,ETH-USDT,SOL-USDT').split(',');

console.log('🚀 Starting arbitrage bot runner');
console.log(`   Ingest URL: ${BASE44_INGEST_URL}`);
console.log(`   Min edge: ${MIN_NET_EDGE_BPS} bps`);
console.log(`   Min fillable: $${MIN_FILLABLE_USD}`);
console.log(`   Pairs: ${PAIRS.join(', ')}`);

// Signal deduplication (prevent spamming same signal)
const lastSignalTime = new Map(); // pair+route => timestamp
const DEDUPE_WINDOW_MS = 30_000; // 30 seconds

async function postSignal(spread) {
  const pair = spread.symbol;
  const route = `${spread.buyExchange}->${spread.sellExchange}`;
  const key = `${pair}:${route}`;
  
  // Check dedupe
  const lastTime = lastSignalTime.get(key) || 0;
  if (Date.now() - lastTime < DEDUPE_WINDOW_MS) {
    return; // Skip duplicate
  }
  
  // Convert to ArbSignal format expected by ingestSignal
  const netEdgeBps = parseFloat(spread.netSpread) * 100; // 0.2% = 20 bps
  const rawSpreadBps = parseFloat(spread.grossSpread) * 100;
  
  // Estimate fillable size (simplified - would need real orderbook data)
  const fillableSize = MIN_FILLABLE_USD * 1.5; // Assume 1.5x minimum
  
  const payload = {
    signal_time: new Date().toISOString(),
    pair: pair,
    asset: pair.split('-')[0] || 'Other',
    buy_exchange: spread.buyExchange,
    sell_exchange: spread.sellExchange,
    buy_price: parseFloat(spread.buyPrice),
    sell_price: parseFloat(spread.sellPrice),
    raw_spread_bps: rawSpreadBps,
    net_edge_bps: netEdgeBps,
    buy_depth_usd: fillableSize,
    sell_depth_usd: fillableSize,
    fillable_size_usd: fillableSize,
    signal_age_ms: Date.now() - new Date(spread.timestamp).getTime(),
    exchange_latency_ms: 100, // Estimate
    confirmed_exchanges: spread.exchangeCount,
    notes: `Confidence: ${spread.confidence}%`,
  };
  
  try {
    const response = await fetch(BASE44_INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BOT_SECRET}`,
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Signal rejected (${response.status}): ${errorText}`);
      return false;
    }
    
    const result = await response.json();
    if (result.signal_id) {
      console.log(`✅ Signal posted: ${pair} ${netEdgeBps.toFixed(1)} bps → ${result.signal_id}`);
      lastSignalTime.set(key, Date.now());
      return true;
    } else if (result.duplicate) {
      console.log(`🔇 Duplicate signal skipped: ${pair}`);
    } else if (result.rejected) {
      console.log(`⚠️ Signal rejected: ${result.reason}`);
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Failed to post signal: ${error.message}`);
    return false;
  }
}

// Initialize and start engine
// Engine config — lowered confidence + faster polling to surface more activity
const engine = new ArbitrageEngine({
  minNetSpreadPct: MIN_NET_EDGE_BPS / 100, // bps → %
  noiseThreshold: 0.015,   // (was 0.02) accept slightly noisier markets
  pollInterval: 2000,      // (was 3000) faster scans
  minConfidence: 40,       // (was 60) surface more candidates
  cooldownMs: 5000,        // (was 10000) faster re-eval per pair
});

// Start the engine with signal posting callback
engine.start(async (spread) => {
  const netEdgeBps = parseFloat(spread.netSpread) * 100;
  
  // Only post signals that meet minimum edge threshold
  if (netEdgeBps >= MIN_NET_EDGE_BPS) {
    await postSignal(spread);
  } else {
    console.log(`📊 ${spread.symbol} ${netEdgeBps.toFixed(1)} bps — below ${MIN_NET_EDGE_BPS} bps floor`);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️ Shutting down...');
  engine.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️ Shutting down...');
  engine.stop();
  process.exit(0);
});