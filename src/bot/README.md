# MBIO Arb WS Bot

WebSocket-based arbitrage signal bot for OKX spot vs OKX perp.

## Setup

```bash
cd bot
cp .env.example .env
# Fill in BASE44_INGEST_URL, BASE44_HEARTBEAT_URL, BOT_SECRET
npm install
npm start
```

## What it does

- Subscribes to Bybit `orderbook.50` channel for BTC-USDT, ETH-USDT, SOL-USDT (spot + perp)
- On every book update, evaluates spot-ask vs perp-bid spread
- If net edge (raw spread − 2× taker fee) ≥ `MIN_EDGE_BPS`, posts a signal to Base44
- Sends a full diagnostic heartbeat every 60 seconds
- Auto-reconnects on WebSocket disconnect

## Signal payload fields sent to `/ingestSignal`

| Field | Description |
|---|---|
| `pair` | e.g. `BTC-USDT` |
| `buy_exchange` | `OKX-spot` |
| `sell_exchange` | `OKX-perp` |
| `buy_price` / `sell_price` | Top-of-book prices |
| `raw_spread_bps` | Perp bid − Spot ask, in bps |
| `net_edge_bps` | raw − 4 bps (2× taker fee) |
| `fillable_size_usd` | min(spot ask depth, perp bid depth) top 5 levels |
| `signal_age_ms` | Age of staler book update |

## Deploy on your server

```bash
# Install pm2 for process management
npm install -g pm2
pm2 start bot.mjs --name arb-bot
pm2 save
pm2 startup
`