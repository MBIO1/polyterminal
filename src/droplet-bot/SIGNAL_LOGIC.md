# Signal Evaluation Logic — v4 (WebSocket)

## Real-Time WebSocket Architecture

The arbitrage engine now uses **Bybit WebSocket V5** for real-time orderbook updates instead of REST polling.

## Connection Setup

```javascript
import { WebsocketClient } from 'bybit-api';

// Initialize WebSocket clients
const wsSpot = new WebsocketClient({ market: 'v5' });
const wsPerp = new WebsocketClient({ market: 'v5' });

// Subscribe to Level 2 Orderbooks (top 50 levels)
wsSpot.subscribeV5(`orderbook.50.BTCUSDT`, 'spot');
wsPerp.subscribeV5(`orderbook.50.BTCUSDT`, 'linear');
```

## Signal Evaluation Logic

### 1. Market State Tracking

```javascript
const marketState = {
  BTCUSDT: {
    spot: { askPrice: 100000, askVol: 0.5, bidPrice: 99999, bidVol: 0.5 },
    perp: { askPrice: 100010, askVol: 1.2, bidPrice: 100009, bidVol: 1.2 }
  }
};
```

### 2. Strategy: Long Spot / Short Perp

```javascript
// Buy Spot @ ASK, Sell Perp @ BID
const grossSpreadBps = ((perp.bidPrice - spot.askPrice) / spot.askPrice) * 10000;
const netEdgeBps = grossSpreadBps - TOTAL_FEE_BPS;
```

### 3. Fee Structure

| Venue | Taker Fee (bps) | Notes |
|-------|-----------------|-------|
| Bybit Spot | ~10 bps | VIP tier dependent |
| Bybit Perp | ~5 bps | VIP tier dependent |
| **Total** | **~10-15 bps** | Adjust `TAKER_FEE_BPS_PER_LEG` in config |

**Default configuration:**
```javascript
const TAKER_FEE_BPS_PER_LEG = 5; // Adjust for your VIP tier
const TOTAL_FEE_BPS = TAKER_FEE_BPS_PER_LEG * 2; // 10 bps total
```

### 4. Volume / Slippage Check

```javascript
const spotNotionalUsd = spot.askPrice * spot.askVol;
const perpNotionalUsd = perp.bidPrice * perp.bidVol;
const maxFillableUsd = Math.min(spotNotionalUsd, perpNotionalUsd);

// Only fire if both edge and size thresholds are met
if (netEdgeBps >= MIN_NET_EDGE_BPS && maxFillableUsd >= MIN_NOTIONAL_USD) {
    fireArbitrageSignal({...});
}
```

## Example Calculation

```
Spot ASK:  $100,000 (vol: 0.5 BTC = $50,000)
Perp BID:  $100,020 (vol: 1.2 BTC = $120,000)

Gross Spread = (100,020 - 100,000) / 100,000 * 10000 = 2.0 bps
Net Edge     = 2.0 - 10.0 = -8.0 bps ❌ (rejected - below fees)

---

Spot ASK:  $100,000 (vol: 0.5 BTC)
Perp BID:  $100,050 (vol: 1.2 BTC)

Gross Spread = 5.0 bps
Net Edge     = 5.0 - 10.0 = -5.0 bps ❌ (rejected)

---

Spot ASK:  $100,000 (vol: 0.5 BTC = $50,000)
Perp BID:  $100,200 (vol: 1.2 BTC = $120,000)

Gross Spread = 20.0 bps
Net Edge     = 20.0 - 10.0 = 10.0 bps ✅
Max Fillable = min($50,000, $120,000) = $50,000 ✅

Signal fired! → Edge: 10.0 bps, Fill: $50,000
```

## Configuration (.env)

```bash
# WebSocket symbols to track
SYMBOLS=BTCUSDT,ETHUSDT

# Minimum net edge after fees (bps)
MIN_NET_EDGE_BPS=3

# Minimum fillable size at top of book (USD)
MIN_NOTIONAL_USD=15

# Bybit WebSocket orderbook depth (50 levels recommended)
ORDERBOOK_DEPTH=50

# Fee configuration (adjust for your VIP tier)
TAKER_FEE_BPS_PER_LEG=5
```

## Advantages over REST Polling

| Feature | REST Polling (v3) | WebSocket (v4) |
|---------|-------------------|----------------|
| Latency | 2000ms poll interval | <100ms real-time |
| Updates | Every 2 seconds | Instant on change |
| API Calls | 60-120 per minute | 2 persistent connections |
| Rate Limits | High risk of hitting limits | No rate limit concerns |
| Signal Speed | Misses fast opportunities | Catches micro-arbitrage |

## Signal Flow

```
Bybit WebSocket → Orderbook Update → Evaluate Edge → POST to Base44
     ↓                                              ↓
  <100ms                                      ~200ms total
```

## Error Handling

```javascript
// WebSocket auto-reconnects on connection loss
wsSpot.on('error', (err) => console.error('WS Error:', err));
wsSpot.on('open', (topic) => console.log('Reconnected:', topic));

// Graceful shutdown on SIGINT/SIGTERM
process.on('SIGINT', () => {
  engine.stop(); // Closes WebSocket connections
  process.exit(0);
});
```

## Monitoring

Check WebSocket connection status in droplet logs:
```bash
pm2 logs arb-bot --lines 50
```

Expected output:
```
🚀 ArbitrageEngine v4 (WebSocket) started
   Symbols: BTCUSDT, ETHUSDT
   Min net edge: 3 bps
   Min notional: $15

📡 Subscribing to BTCUSDT orderbooks...
📡 Subscribing to ETHUSDT orderbooks...
✅ Spot WS connected: orderbook.50.BTCUSDT
✅ Perp WS connected: orderbook.50.BTCUSDT
✅ Spot WS connected: orderbook.50.ETHUSDT
✅ Perp WS connected: orderbook.50.ETHUSDT
🎯 [SIGNAL] BTC-USDT | Edge: 4.5 bps | Fill: $2500
✅ Signal posted: BTC-USDT 4.5 bps → SIG-12345
``