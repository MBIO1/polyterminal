# MBIO Arb Droplet Setup

## Architecture

```
[OKX WS / Bybit WS]
       │  real-time tickers
       ▼
  bot.mjs (WS signal engine)
       │  POST /functions/ingestSignal
       │  POST /functions/ingestHeartbeat
       ▼
   Base44 Cloud
       │  executeSignals (when bot_running=true)
       │  POST http://DROPLET_IP:4001/execute
       ▼
 order-server.mjs (HTTP on port 4001)
       │  Bybit REST API (signed)
       ▼
  Bybit Exchange
```

## Files on Droplet (`/opt/arb-bot/`)

| File | Purpose |
|---|---|
| `bot.mjs` | WebSocket signal scanner (OKX + Bybit) — **the main bot** |
| `order-server.mjs` | HTTP execution server on port 4001 |
| `.env` | All secrets and config |
| `package.json` | `npm install` dependencies |

## Initial Droplet Setup (one-time)

```bash
# On the droplet as root:
mkdir -p /opt/arb-bot && cd /opt/arb-bot
npm init -y && npm install ws dotenv

# From Base44 dashboard: run setupDroplet function to write .env + order-server.mjs
# Then run deployBot function to write bot.mjs

# Install systemd services
cat > /etc/systemd/system/arb-order-server.service << EOF
[Unit]
Description=Arb Order Server
After=network.target

[Service]
WorkingDirectory=/opt/arb-bot
ExecStart=/usr/bin/node order-server.mjs
Restart=always
RestartSec=5
EnvironmentFile=/opt/arb-bot/.env

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/arb-bot.service << EOF
[Unit]
Description=Arb Signal Bot
After=network.target

[Service]
WorkingDirectory=/opt/arb-bot
ExecStart=/usr/bin/node bot.mjs
Restart=always
RestartSec=5
EnvironmentFile=/opt/arb-bot/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable arb-order-server arb-bot
systemctl start arb-order-server arb-bot
systemctl status arb-order-server arb-bot
```

## Required `.env` Variables

```
# Shared secret (must match Base44 DROPLET_SECRET)
DROPLET_SECRET=...

# Bybit API credentials (mainnet or testnet)
BYBIT_API_KEY=...
BYBIT_API_SECRET=...
BYBIT_TESTNET=false

# Ports
ORDER_SERVER_PORT=4001

# Base44 endpoints (auto-set by setupDroplet / deployBot)
BASE44_INGEST_URL=https://polytrade.base44.app/functions/ingestSignal
BASE44_HEARTBEAT_URL=https://polytrade.base44.app/functions/ingestHeartbeat
BASE44_STATS_URL=https://polytrade.base44.app/functions/signalStats
BASE44_RESULT_URL=https://polytrade.base44.app/functions/ingestTradeResult
BASE44_USER_TOKEN=...

# Bot config
MIN_NET_EDGE_BPS=2
ALERT_EDGE_BPS=20
MIN_FILLABLE_USD=500
DISABLE_BINANCE=true
PAIRS=BTC-USDT,ETH-USDT,SOL-USDT,BNB-USDT,AVAX-USDT
```

## Re-deploy after code changes

From the Base44 app dashboard → ArbInstructions page, or via:
1. Run `setupDroplet` function → writes `.env` + `order-server.mjs`
2. Run `deployBot` function → writes `bot.mjs` + restarts `arb-bot` service

## Check logs

```bash
journalctl -u arb-bot -f
journalctl -u arb-order-server -f
```

## Why "0 signals/hr – blocked"?

This means `bot.mjs` is not posting signals. Common causes:
1. `BASE44_INGEST_URL` missing from `.env` → run `deployBot` to fix
2. `BASE44_USER_TOKEN` expired → update in Base44 secrets
3. Bot process crashed → `systemctl restart arb-bot`
4. Edge < `MIN_NET_EDGE_BPS` threshold → check heartbeat `bucket_*` fields