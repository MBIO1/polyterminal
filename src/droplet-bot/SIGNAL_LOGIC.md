# Signal Evaluation Logic — v3 Update

## Real Bybit Trading Behavior

The arbitrage engine now uses **real orderbook prices** instead of last trade prices:

### Long Spot / Short Perp (Carry Trade)

```javascript
// Fetch real orderbook prices
const spotAsk = spotOrderbook.asks[0].price;  // Price we BUY spot
const perpBid = perpOrderbook.bids[0].price;  // Price we SELL perp

// Calculate gross spread in basis points
const grossSpreadBps = ((perpBid - spotAsk) / spotAsk) * 10000;

// Subtract exact Bybit taker fees
const TOTAL_TAKER_FEES_BPS = 15.5;  // spot: 10 bps + perp: 5.5 bps
const TOTAL_SLIPPAGE_BPS = 2;       // conservative 1 bps per leg

// Calculate Net Edge
const netEdgeBps = grossSpreadBps - TOTAL_TAKER_FEES_BPS - TOTAL_SLIPPAGE_BPS;

// Fire signal if net edge exceeds minimum threshold
if (netEdgeBps >= MIN_NET_EDGE_BPS) {
    fireArbitrageSignal({ 
        direction: 'long_spot_short_perp', 
        netEdge: netEdgeBps 
    });
}
```

## Fee Structure

| Venue | Taker Fee (bps) | Taker Fee (%) |
|-------|-----------------|---------------|
| Bybit Spot | 10 bps | 0.10% |
| Bybit Perp (Linear) | 5.5 bps | 0.055% |
| **Total** | **15.5 bps** | **0.155%** |

## Slippage Model

- **Spot**: 1 bps (0.01%)
- **Perp**: 1 bps (0.01%)
- **Total**: 2 bps (0.02%)

## Example Calculation

```
Spot Ask:  $100,000
Perp Bid:  $100,020

Gross Spread = (100,020 - 100,000) / 100,000 * 10000 = 2.0 bps
Net Edge     = 2.0 - 15.5 - 2.0 = -15.5 bps ❌ (rejected)

---

Spot Ask:  $100,000
Perp Bid:  $100,050

Gross Spread = (100,050 - 100,000) / 100,000 * 10000 = 5.0 bps
Net Edge     = 5.0 - 15.5 - 2.0 = -12.5 bps ❌ (rejected)

---

Spot Ask:  $100,000
Perp Bid:  $100,200

Gross Spread = (100,200 - 100,000) / 100,000 * 10000 = 20.0 bps
Net Edge     = 20.0 - 15.5 - 2.0 = 2.5 bps ✅ (signal fired)
```

## Key Changes from v2

1. **Orderbook-based**: Uses `asks[0]` and `bids[0]` instead of `lastPrice`
2. **Basis points**: All calculations in bps for precision
3. **Explicit fees**: Bybit taker fees hardcoded (15.5 bps total)
4. **Explicit slippage**: Conservative 2 bps total
5. **Same-venue only**: Focuses on Bybit spot vs Bybit perp (no cross-venue)

## Configuration

Set `MIN_NET_EDGE_BPS` in the droplet `.env` file:

```bash
MIN_NET_EDGE_BPS=3  # Minimum net edge after fees/slippage
```

This matches the `ingestSignal` function's floor of 3 bps.