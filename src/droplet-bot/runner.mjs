/**
 * Arbitrage Bot Runner — connects the detection engine to Base44
 * Posts qualified signals to Base44 ingestSignal endpoint
 */

import ArbitrageEngine from './bot.mjs';

// Configuration from environment
const BASE44_INGEST_URL = process.env.BASE44_INGEST_URL || 'https://polytrade.base44.app/functions/ingestSignal';
const BOT_SECRET = process.env.BOT_SECRET || process.env.DROPLET_SECRET || '';
// Floor matches ingestSignal's own minimum (3 bps)
const MIN_NET_EDGE_BPS = parseInt(process.env.MIN_NET_EDGE_BPS) || 3;
const MIN_FILLABLE_USD = parseInt(process.env.MIN_FILLABLE_USD) || 200;
const PAIRS = (process.env.PAIRS || 'BTC-USDT,ETH-USDT,SOL-USDT').split(',');

console.log('🚀 Starting arbitrage bot runner');
console.log(`   Ingest URL: ${BASE44_INGEST_URL}`);
console.log(`   Min edge: ${MIN_NET_EDGE_BPS} bps`);
console.log(`   Min fillable: $${MIN_FILLABLE_USD}`);
console.log(`   Pairs: ${PAIRS.join(', ')}`);

// Note: deduplication is handled by the engine's cooldownMs — no runner-level dedupe needed

async function postSignal(spread) {
  const rawSym = spread.symbol || '';
  const pair = rawSym.replace(/^(BTC|ETH|SOL)(USDT)$/, '$1-$2') || rawSym;

  // Convert to ArbSignal format expected by ingestSignal
  // v3 engine: netSpread and grossSpread are already in % (e.g. 0.12 = 12 bps)
  const netEdgeBps = parseFloat(spread.netSpread) * 100;
  const rawSpreadBps = parseFloat(spread.grossSpread) * 100;

  // Depth is estimated — REST tickers don't provide L2 depth.
  // Using MIN_FILLABLE_USD * 2 as conservative estimate.
  const fillableSize = spread.buyDepthUsd || spread.sellDepthUsd || (MIN_FILLABLE_USD * 2);

  const payload = {
    signal_time:         new Date().toISOString(),
    pair:                pair,
    asset:               pair.split('-')[0] || 'Other',
    buy_exchange:        spread.buyExchange,
    sell_exchange:       spread.sellExchange,
    buy_price:           Number(spread.buyPrice),
    sell_price:          Number(spread.sellPrice),
    raw_spread_bps:      rawSpreadBps,
    net_edge_bps:        netEdgeBps,
    buy_depth_usd:       fillableSize,
    sell_depth_usd:      fillableSize,
    fillable_size_usd:   fillableSize,
    signal_age_ms:       Date.now() - new Date(spread.timestamp).getTime(),
    exchange_latency_ms: 50,
    confirmed_exchanges: spread.exchangeCount || 2,
    notes:               `gross:${rawSpreadBps.toFixed(1)}bps net:${netEdgeBps.toFixed(1)}bps`,
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

// Initialize and start engine (v3)
const engine = new ArbitrageEngine({
  minNetSpreadPct: MIN_NET_EDGE_BPS / 100, // bps → % (e.g. 3 bps = 0.03%)
  pollInterval: 2000,
  cooldownMs: 5000,
  minConfidence: 0, // disabled — edge floor is the only gate
});

// Start the engine with signal posting callback
// v3 engine already filters by minNetSpreadPct, so everything here is above floor
engine.start(async (spread) => {
  const netEdgeBps = parseFloat(spread.netSpread) * 100;
  if (netEdgeBps >= MIN_NET_EDGE_BPS) {
    await postSignal(spread);
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