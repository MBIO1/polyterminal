/**
 * Arbitrage Bot Runner — connects the WebSocket engine to Base44
 * Posts qualified signals to Base44 ingestSignal endpoint
 */

import { ArbitrageEngine } from './bot.mjs';

// Configuration from environment
const BASE44_INGEST_URL = process.env.BASE44_INGEST_URL || 'https://polytrade.base44.app/functions/ingestSignal';
const BOT_SECRET = process.env.BOT_SECRET || process.env.DROPLET_SECRET || '';
const MIN_NET_EDGE_BPS = parseFloat(process.env.MIN_NET_EDGE_BPS) || 3;
const MIN_NOTIONAL_USD = parseFloat(process.env.MIN_NOTIONAL_USD) || 15;
const SYMBOLS = (process.env.SYMBOLS || 'BTCUSDT,ETHUSDT').split(',');

console.log('🚀 Starting arbitrage bot runner (WebSocket v4)');
console.log(`   Ingest URL: ${BASE44_INGEST_URL}`);
console.log(`   Min edge: ${MIN_NET_EDGE_BPS} bps`);
console.log(`   Min notional: $${MIN_NOTIONAL_USD}`);
console.log(`   Symbols: ${SYMBOLS.join(', ')}\n`);

async function postSignal(signalData) {
  const pair = signalData.symbol;
  const asset = pair.split('-')[0] || 'Other';
  const netEdgeBps = parseFloat(signalData.netEdgeBps);
  
  // Estimate fillable size from signal data
  const fillableSize = parseFloat(signalData.fillableUsd) || (MIN_NOTIONAL_USD * 2);
  
  const payload = {
    signal_time:         new Date().toISOString(),
    pair:                pair,
    asset:               asset,
    buy_exchange:        'bybit-spot',
    sell_exchange:       'bybit-perp',
    buy_price:           Number(signalData.spotPrice),
    sell_price:          Number(signalData.perpPrice),
    raw_spread_bps:      (netEdgeBps + 10), // approx gross (net + fees)
    net_edge_bps:        netEdgeBps,
    buy_depth_usd:       fillableSize,
    sell_depth_usd:      fillableSize,
    fillable_size_usd:   fillableSize,
    signal_age_ms:       0, // WebSocket = real-time
    exchange_latency_ms: 1, // WebSocket latency
    confirmed_exchanges: 2,
    notes:               `net:${netEdgeBps.toFixed(1)}bps fill:$${signalData.fillableUsd}`,
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

// Initialize and start WebSocket engine
const engine = new ArbitrageEngine({
  symbols: SYMBOLS,
  minNetEdgeBps: MIN_NET_EDGE_BPS,
  minNotionalUsd: MIN_NOTIONAL_USD,
});

// Start the engine with signal posting callback
engine.start(async (signalData) => {
  const netEdgeBps = parseFloat(signalData.netEdgeBps);
  if (netEdgeBps >= MIN_NET_EDGE_BPS) {
    await postSignal(signalData);
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