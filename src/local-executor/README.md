# Local Trade Executor for Polymarket CLOB

Execute live trades on Polymarket using Bright Data residential proxy to bypass geoblocking. Runs on your local machine.

## Why Local?

Deno Deploy sandboxes all network access—proxies, subprocesses, and custom dispatchers are blocked. Live trades **must execute locally** with proper HTTP tunneling via Bright Data.

## Setup

### 1. Install Dependencies

```bash
cd local-executor
npm install ethers https-proxy-agent
```

### 2. Set Environment Variables

Create a `.env` file or export them:

```bash
export BRIGHT_DATA_SUPERPROXY_HOST="brd.superproxy.io"
export BRIGHT_DATA_SUPERPROXY_PORT="33335"
export BRIGHT_DATA_SUPERPROXY_USER="your_bright_data_user"
export BRIGHT_DATA_SUPERPROXY_PASS="your_bright_data_pass"

export POLY_WALLET_ADDRESS="0x..."
export POLY_PRIVATE_KEY="0x..."
export POLY_API_KEY="poly_..."
export POLY_API_SECRET="..."
export POLY_API_PASSPHRASE="..."
```

### 3. Load from Base44 Secrets (Recommended)

Export directly from your Base44 dashboard environment variables into your shell:

```bash
source <(base44 env export)
```

Or use `dotenv`:

```bash
npm install dotenv
# Create .env with secrets, then load in script
```

## Usage

### Execute a $1 Test Trade

```bash
node trade-executor.js \
  --tokenId=21742633143463906290569050155826241533067272736897614950488156847949938836455 \
  --side=0 \
  --price=0.52 \
  --size=1
```

### Parameters

- `--tokenId` — Polymarket token ID (YES/NO contract)
- `--side` — `0` = BUY, `1` = SELL
- `--price` — Order price (0.01–0.99)
- `--size` — Position size in USDC

### Example Output

```
╔══════════════════════════════════════════════════════════════╗
║  Polymarket CLOB Trade Executor (Local + Bright Data Proxy)  ║
╚══════════════════════════════════════════════════════════════╝

🚀 Executing order via Bright Data proxy...
   Token: 21742633...
   Side: BUY | Price: 0.52 | Size: $1

📋 Building EIP-712 order struct...
🔐 Signing with EIP-712...
   Signature: 0x1f2a4b8c9d...abc123def

🔑 Computing HMAC-SHA256 REST auth...

📡 Broadcasting via Bright Data to CLOB...

✅ Order accepted!
   Order ID: 12345

🎉 Trade execution complete!
```

## How It Works

1. **Build EIP-712 Order Struct** — Package trade params (tokenId, side, price, size)
2. **Sign Locally** — ethers.js signs with your private key (never leaves local machine)
3. **Compute HMAC-SHA256** — Generate REST authentication header using API secret
4. **Bright Data Tunnel** — Route HTTPS request through residential proxy for non-US IP
5. **CLOB Broadcast** — POST signed order to Polymarket order book
6. **Settle** — Order matches, fills, or gets cancelled based on market state

## Security

- ✅ Private key never transmitted to server or proxy
- ✅ All signing happens locally
- ✅ Bright Data proxy handles geoblocking only—cannot see order contents
- ✅ HMAC signature prevents replay attacks
- ✅ EIP-712 ensures order integrity

## Troubleshooting

### `POLY_API_KEY not set`

Export your Base44 secrets:

```bash
export $(cat .env | grep POLY | xargs)
```

### `Signature verification failed`

Ensure `POLY_PRIVATE_KEY` matches `POLY_WALLET_ADDRESS`.

### `403 Geoblocked`

Verify Bright Data credentials are correct:

```bash
curl -x http://user:pass@brd.superproxy.io:33335 https://geo.brdtest.com/welcome.txt
```

### `Connection timeout`

Bright Data proxy may be slow. Increase timeout in `trade-executor.js` line ~180.

## Next Steps

- Run daily trades via cron: `0 9 * * * node /path/trade-executor.js --tokenId=... --side=0 --price=0.5 --size=10`
- Integrate with botRunner automation to queue live orders
- Monitor order IDs via Polymarket API to confirm settlement