# Droplet WebSocket Arb Bot — Bidirectional Basis Carry

This directory contains the reference WebSocket bot that runs on your DigitalOcean droplet (or any VPS). It does NOT run on Base44 — Base44 is the command center, alerting layer, and signal log. The droplet is the real-time edge.

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                       DROPLET (VPS)                       │
│                                                           │
│   WebSocket feeds (persistent, same-venue spot vs perp)   │
│   ┌─────────────────┐      ┌──────────────────┐           │
│   │  OKX spot+perp  │      │ Bybit spot+perp  │           │
│   └────────┬────────┘      └─────────┬────────┘           │
│            └──────────┬───────────────┘                   │
│                       ▼                                   │
│              ┌─────────────────┐                          │
│              │  Basis Engine   │                          │
│              │                 │                          │
│              │ • Contango:     │  perp > spot             │
│              │   long spot /   │                          │
│              │   short perp    │                          │
│              │ • Backward.:    │  spot > perp             │
│              │   long perp /   │                          │
│              │   short spot    │                          │
│              │ • Fee-adjusted  │                          │
│              │ • Depth check   │                          │
│              │ • TTL filter    │                          │
│              └────────┬────────┘                          │
│                       │ POST qualified signals            │
└───────────────────────┼───────────────────────────────────┘
                        ▼
              ┌──────────────────┐
              │     BASE44       │
              │                  │
              │ /ingestSignal ──▶│──▶ ArbSignal entity
              │                  │──▶ Slack / Telegram
              │ /signalStats  ◀──│◀── adaptive threshold
              │ /downloadBot  ──▶│──▶ latest bot.mjs
              │                  │
              │ UI: /signals     │
              │ Executor:        │
              │ /executeSignals  │──▶ ArbTrade (paper/live)
              └──────────────────┘
```

## Setup on Droplet

```bash
ssh root@YOUR_DROPLET
mkdir -p /opt/arb-bot && cd /opt/arb-bot

# Pull the latest bot code from Base44
curl -s https://YOUR_APP.base44.app/functions/downloadBot -o bot.mjs

# Install deps (only ws + dotenv are needed)
npm init -y
npm install ws dotenv
```

### Environment variables (`/opt/arb-bot/.env`)

```env
# Base44 endpoints — your app's function base URL
BASE44_INGEST_URL=https://YOUR_APP.base44.app/functions/ingestSignal
BASE44_HEARTBEAT_URL=https://YOUR_APP.base44.app/functions/ingestHeartbeat
BASE44_STATS_URL=https://YOUR_APP.base44.app/functions/signalStats

# A user token from Base44 (dashboard → your profile → API token)
# Must belong to a registered user of the app.
BASE44_USER_TOKEN=paste-your-token-here

# ── TUNING ── MUST stay consistent with ArbConfig in the Base44 UI ──────────
PAIRS=BTC-USDT,ETH-USDT,SOL-USDT,AVAX-USDT,LINK-USDT,DOGE-USDT,ADA-USDT,ATOM-USDT,APT-USDT,SUI-USDT,ARB-USDT,OP-USDT,INJ-USDT,SEI-USDT,TIA-USDT

# per-leg taker fee in bps — MUST match ArbConfig.taker_fee_bps_per_leg in Base44.
# net_edge = raw_spread - 4 × TAKER_FEE_BPS  (4 round-trip legs)
TAKER_FEE_BPS=2

# minimum net edge (post 4-leg fees) to POST a signal. Keep low for visibility;
# the executor gates on ArbConfig thresholds anyway.
MIN_NET_EDGE_BPS=2

# net edge at which alert=true fires Telegram/Slack in ingestSignal.
# MUST match TELEGRAM_ALERT_MIN_BPS in functions/ingestSignal (default 20 bps).
ALERT_EDGE_BPS=20

MAX_SIGNAL_AGE_MS=1500      # drop ticks older than this (ms)
MIN_FILLABLE_USD=100        # top-of-book USD depth required on both legs
CONFIRM_MIN_RATIO=0.5       # cross-venue confirmation sensitivity (0–1)
HEARTBEAT_MS=60000          # heartbeat POST cadence (ms)
```

**Key alignment rules (never drift these):**

| Constant | Droplet `.env` | Base44 ArbConfig | ingestSignal |
|---|---|---|---|
| Per-leg fee | `TAKER_FEE_BPS` | `taker_fee_bps_per_leg` | hardcoded comment (8 bps = 4×2) |
| Alert floor | `ALERT_EDGE_BPS=20` | n/a | `TELEGRAM_ALERT_MIN_BPS=20` |
| Fee legs | always `4 × TAKER_FEE_BPS` | `4 × taker_fee_bps_per_leg` | matches |

### Run with systemd

`/etc/systemd/system/arb-bot.service`:

```ini
[Unit]
Description=Arb WebSocket Bot (bidirectional basis carry)
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

1. **Opens WebSocket connections** to OKX (spot + SWAP perp) and Bybit (spot orderbook + linear perp tickers) for each configured pair.
2. **On every tick update**, recomputes the same-venue basis in **both directions**:
   - **Contango** (`perp.bid > spot.ask`) → long spot / short perp
   - **Backwardation** (`spot.bid > perp.ask`) → long perp / short spot
   The larger of the two opportunities is selected per venue.
3. **Filters**:
   - Fee-adjusted: `net_edge = raw_spread − 2 × taker_fee_bps`
   - Depth: top-of-book USD liquidity ≥ `MIN_FILLABLE_USD` on both legs
   - TTL: drops signals older than `MAX_SIGNAL_AGE_MS`
   - Dedupe: ≤ 1 signal per (pair, route) per 20s
4. **POSTs qualified signals** to `/functions/ingestSignal` with `Authorization: Bearer $BASE44_USER_TOKEN`. Signals carry `confirmed_exchanges: 2` (spot + perp legs of the same venue).
5. **Polls `/functions/signalStats`** every 15 min to adjust per-pair thresholds based on realized win rate (floored at 2 bps).
6. **Heartbeats every 60s** with eval counts, rejection breakdown, best edge seen, and per-venue freshness.

## Updating the bot

Base44 serves the current bot source at `/functions/downloadBot`. To refresh the droplet:

```bash
ssh root@YOUR_DROPLET
cd /opt/arb-bot
curl -s https://YOUR_APP.base44.app/functions/downloadBot -o bot.mjs
systemctl restart arb-bot
journalctl -u arb-bot -f
```

See `bot.mjs` (and `functions/downloadBot` in the Base44 app) for the implementation.