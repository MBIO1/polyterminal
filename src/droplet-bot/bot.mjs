/**
 * ArbitrageEngine v4 — Bybit WebSocket Spot/Perp Basis Scanner
 * 
 * Uses real-time WebSocket orderbooks instead of REST polling
 * Fires signals when net edge exceeds threshold after fees
 */

import { WebsocketClient } from 'npm:bybit-api@3.10.0';

// Configuration from environment
const MIN_NET_EDGE_BPS = parseFloat(process.env.MIN_NET_EDGE_BPS) || 3;
const MIN_NOTIONAL_USD = parseFloat(process.env.MIN_NOTIONAL_USD) || 15;
const TAKER_FEE_BPS_PER_LEG = 5; // Bybit default: 5 bps perp, 10 bps spot (adjust for VIP tier)
const TOTAL_FEE_BPS = TAKER_FEE_BPS_PER_LEG * 2; // 10 bps total for both legs

// State object to hold real-time top-of-book data
const marketState = {};

// Callback for when a signal is detected
let onSignalCallback = null;

// WebSocket clients
let wsSpot = null;
let wsPerp = null;

// Symbols to track (e.g., ['BTCUSDT', 'ETHUSDT'])
let trackedSymbols = [];

export class ArbitrageEngine {
  constructor(config = {}) {
    this.config = {
      symbols: config.symbols || ['BTCUSDT', 'ETHUSDT'],
      minNetEdgeBps: config.minNetEdgeBps || MIN_NET_EDGE_BPS,
      minNotionalUsd: config.minNotionalUsd || MIN_NOTIONAL_USD,
      ...config,
    };
    
    trackedSymbols = this.config.symbols;
  }

  // Initialize Bybit WebSocket Clients (V5)
  start(onSignal) {
    onSignalCallback = onSignal;
    
    console.log('🚀 ArbitrageEngine v4 (WebSocket) started');
    console.log(`   Symbols: ${trackedSymbols.join(', ')}`);
    console.log(`   Min net edge: ${this.config.minNetEdgeBps} bps`);
    console.log(`   Min notional: $${this.config.minNotionalUsd}\n`);

    const wsConfig = { market: 'v5' };
    wsSpot = new WebsocketClient({ ...wsConfig, testnet: false });
    wsPerp = new WebsocketClient({ ...wsConfig, testnet: false });

    // Subscribe to orderbooks for each symbol
    trackedSymbols.forEach(symbol => {
      console.log(`📡 Subscribing to ${symbol} orderbooks...`);
      
      // Subscribe to Spot Orderbook (top 50 levels)
      wsSpot.subscribeV5(`orderbook.50.${symbol}`, 'spot');
      
      // Subscribe to Linear/Perp Orderbook (top 50 levels)
      wsPerp.subscribeV5(`orderbook.50.${symbol}`, 'linear');
    });

    // Handle Spot Updates
    wsSpot.on('update', (data) => {
      if (data.topic?.startsWith('orderbook') && data.data) {
        const symbol = this.extractSymbolFromTopic(data.topic);
        if (symbol) {
          this.updateMarketState(symbol, 'spot', data.data);
          this.evaluateSignal(symbol);
        }
      }
    });

    // Handle Perp Updates
    wsPerp.on('update', (data) => {
      if (data.topic?.startsWith('orderbook') && data.data) {
        const symbol = this.extractSymbolFromTopic(data.topic);
        if (symbol) {
          this.updateMarketState(symbol, 'perp', data.data);
          this.evaluateSignal(symbol);
        }
      }
    });

    // Error handling
    wsSpot.on('error', (err) => console.error('❌ Spot WS Error:', err.message));
    wsPerp.on('error', (err) => console.error('❌ Perp WS Error:', err.message));

    // Connection status
    wsSpot.on('open', (topic) => console.log(`✅ Spot WS connected: ${topic}`));
    wsPerp.on('open', (topic) => console.log(`✅ Perp WS connected: ${topic}`));
  }

  // Extract symbol from topic string (e.g., "orderbook.50.BTCUSDT" -> "BTCUSDT")
  extractSymbolFromTopic(topic) {
    const parts = topic.split('.');
    if (parts.length >= 3) {
      return parts[2];
    }
    return null;
  }

  // Parse Bybit's [Price, Size] arrays to update the top of the book
  updateMarketState(symbol, marketType, data) {
    if (!marketState[symbol]) {
      marketState[symbol] = {
        spot: { askPrice: 0, askVol: 0, bidPrice: 0, bidVol: 0 },
        perp: { askPrice: 0, askVol: 0, bidPrice: 0, bidVol: 0 }
      };
    }

    // Bybit sends 'a' (asks) and 'b' (bids) as arrays: [ ["price", "size"], ... ]
    if (data.a && data.a.length > 0) {
      marketState[symbol][marketType].askPrice = parseFloat(data.a[0][0]);
      marketState[symbol][marketType].askVol = parseFloat(data.a[0][1]);
    }
    if (data.b && data.b.length > 0) {
      marketState[symbol][marketType].bidPrice = parseFloat(data.b[0][0]);
      marketState[symbol][marketType].bidVol = parseFloat(data.b[0][1]);
    }
  }

  // Evaluate True Fillable Edge
  evaluateSignal(symbol) {
    const state = marketState[symbol];
    if (!state) return;

    const { spot, perp } = state;

    // Ensure we have data for both legs before calculating
    if (!spot.askPrice || !perp.bidPrice) return;

    // --- STRATEGY: Long Spot, Short Perp ---
    // You buy at the Spot ASK, and sell at the Perp BID.
    const grossSpreadBps = ((perp.bidPrice - spot.askPrice) / spot.askPrice) * 10000;
    const netEdgeBps = grossSpreadBps - TOTAL_FEE_BPS;

    // Volume / Slippage Check
    // Calculate the total USD value available at the top of the book
    const spotNotionalUsd = spot.askPrice * spot.askVol;
    const perpNotionalUsd = perp.bidPrice * perp.bidVol;
    
    // The maximum order size we can execute without slipping to the next price level
    const maxFillableUsd = Math.min(spotNotionalUsd, perpNotionalUsd);

    if (netEdgeBps >= this.config.minNetEdgeBps && maxFillableUsd >= this.config.minNotionalUsd) {
      const signalData = {
        symbol: symbol.replace('USDT', '-USDT'),
        direction: 'LONG_SPOT_SHORT_PERP',
        netEdgeBps: netEdgeBps.toFixed(2),
        spotPrice: spot.askPrice,
        perpPrice: perp.bidPrice,
        fillableUsd: maxFillableUsd.toFixed(2),
        timestamp: new Date().toISOString(),
      };

      console.log(`🎯 [SIGNAL] ${signalData.symbol} | Edge: ${signalData.netEdgeBps} bps | Fill: $${signalData.fillableUsd}`);

      if (onSignalCallback) {
        onSignalCallback(signalData);
      }
    }
  }

  // Stop WebSocket connections
  stop() {
    console.log('⏹️ Stopping WebSocket connections...');
    if (wsSpot) {
      wsSpot.close();
      wsSpot = null;
    }
    if (wsPerp) {
      wsPerp.close();
      wsPerp = null;
    }
    trackedSymbols = [];
    onSignalCallback = null;
  }

  // Get current market state (for debugging/monitoring)
  getMarketState() {
    return marketState;
  }
}

// Export for CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ArbitrageEngine };
}