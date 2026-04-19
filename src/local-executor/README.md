# Droplet Trade Executor for Polymarket CLOB

Executes live trades on Polymarket directly from the DigitalOcean droplet. **No proxy.** The droplet's IP (`64.225.16.230`) is not geoblocked by Polymarket.

## Why on the droplet?

Base44 backend functions run on Deno Deploy, whose cloud IPs are geoblocked by Polymarket's CLOB. The droplet has a clean residential-grade IP that hits CLOB directly. All signing happens locally; the private key never leaves the droplet.

## Setup

```bash
cd local-executor
npm install
```

## Environment Variables

Required:

```bash
export POLY_PRIVATE_KEY="0x..."
export POLY_WALLET_ADDRESS="0x..."
```

Optional (enables logging trades back to Base44 `BotTrade`):

```bash
export BASE44_API_KEY="..."
export BASE44_APP_ID="..."
```

Put them in `.env` and `source` it, or use `pm2` / systemd with the env baked in.

## Usage

```bash
node trade-executor.js \
  --tokenId=<polymarket_token_id> \
  --side=<0|1> \
  --price=<0.01-0.99> \
  --size=<usdc>
```

- `--side=0` → BUY
- `--side=1` → SELL

### Example — $5 BUY YES @ 0.16

```bash
node trade-executor.js \
  --tokenId=10355316169421062771540371697837923442956106006258739802114788264214901200573 \
  --side=0 \
  --price=0.16 \
  --size=5
```

## How it works

1. Derive fresh Polymarket L2 API creds (L1 signed with wallet).
2. Build EIP-712 order struct (salt, maker, tokenId, amounts, expiration, nonce).
3. Sign locally with `ethers.js`.
4. Compute HMAC-SHA256 REST auth header using the derived API secret.
5. `POST /order` directly to `clob.polymarket.com` — from the droplet's IP.
6. (Optional) log the accepted order to Base44 `BotTrade` via REST.

## Security

- Private key never transmitted anywhere — signing is local.
- Fresh API creds derived on every run; no stale secrets.
- Direct fetch only — no third-party proxy in the path.