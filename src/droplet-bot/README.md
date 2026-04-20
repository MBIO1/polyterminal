# Droplet WebSocket Arb Bot

This directory contains the reference WebSocket bot that runs on your DigitalOcean droplet (or any VPS). It does NOT run on Base44 — Base44 is the command center, alerting layer, and signal log. The droplet is the real-time edge.

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                       DROPLET (VPS)                       │
│                                                           │
│   WebSocket feeds (parallel, persistent connections)      │
│   ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌───────┐       │
│   │  OKX    │  │ Binance │  │ Coinbase │  │ Bybit │       │
│   └────┬────┘  └────┬────┘  └─────┬────┘  └───┬───┘       │
│        └───────────┴──────┬──────┴──────────┘             │
│                           ▼                               │
│                  ┌─────────────────┐                      │
│                  │  Signal Engine  │                      │
│                  │                 │                      │
│                  │ • Fee-adjusted  │                      │
│                  │ • Depth check   │                      │
│                  │ • Slippage est  │                      │
│                  │ • TTL filter    │                      │
│                  │ • Cross-venue   │                      │
│                  │   confirmation  │                      │
│                  └────────┬────────┘                      │
│                           │ POST qualified signals        │
└───────────────────────────┼───────────────────────────────┘
                            ▼
                  ┌──────────────────┐
                  │     BASE44       │
                  │                  │
                  │ /ingestSignal ──▶│──▶ ArbSignal entity
                  │                  │──▶ Slack / Telegram
                  │ /signalStats  ◀──│◀── adaptive threshold
                  │                  │
                  │ UI: /signals     │
                  └──────────────────┘
```

## Setup on Droplet

```bash
ssh root@YOUR_DROPLET
mkdir -p /opt/arb-bot && cd /opt/arb-bot
# Copy bot.mjs + package.json into this directory
npm install
```

### Environment variables (`/opt/arb-bot/.env`)

```env
# Base44 endpoint - your app's function base URL
BASE44_INGEST_URL=https://YOUR_APP.base44.app/functions/ingestSignal
BASE44_STATS_URL=https://YOUR_APP.base44.app/functions/signalStats

# A user token from Base44 (dashboard → your profile → API token)
# Must belong to a registered user of the app.
BASE44_USER_TOKEN=paste-your-token-here

# Tuning
PAIRS=BTC-USDT,ETH-USDT,SOL-USDT
MIN_NET_EDGE_BPS=5
MAX_SIGNAL_AGE_MS=200
MIN_FILLABLE_USD=10000
ALERT_EDGE_BPS=15
TAKER_FEE_BPS=10
```

### Run with systemd

`/etc/systemd/system/arb-bot.service`:

```ini
[Unit]
Description=Arb WebSocket Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/arb-bot
EnvironmentFile=/opt/arb-bot/.env
ExecStart=/usr/bin/node bot.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable arb-bot
systemctl start arb-bot
journalctl -u arb-bot -f
```

## What the bot does

1. **Opens 4 persistent WebSocket connections** (OKX, Binance, Coinbase, Bybit) for each configured pair — ticker + top-5 order book levels.
2. **On every tick update**, recomputes cross-exchange spread matrix.
3. **Filters**:
   - Fee-adjusted: `net_edge = raw_spread - 2 × taker_fee`
   - Depth: top-5 USD liquidity ≥ `MIN_FILLABLE_USD` on both legs
   - TTL: drops signals older than `MAX_SIGNAL_AGE_MS`
   - Confirmation: at least 3 of 4 exchanges must have fresh ticks
4. **POSTs qualified signals** to `/functions/ingestSignal` with `Authorization: Bearer $BASE44_USER_TOKEN`.
5. **Polls `/functions/signalStats`** every 15 min to adjust per-pair thresholds based on realized win rate.

See `bot.mjs` for the implementation.