// writeOrderServerEnv — returns a shell one-liner to write the complete .env file
// (BOT_SECRET, DROPLET_SECRET, BYBIT_*, BASE44_USER_TOKEN, etc.) into /opt/arb-bot/.env,
// install dotenv, and restart the order-server under pm2.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const BOT_SECRET       = Deno.env.get('BOT_SECRET')       || '';
    const DROPLET_SECRET   = Deno.env.get('DROPLET_SECRET')   || '';
    const BYBIT_API_KEY    = Deno.env.get('BYBIT_API_KEY')    || '';
    const BYBIT_API_SECRET = Deno.env.get('BYBIT_API_SECRET') || '';
    const BYBIT_TESTNET    = Deno.env.get('BYBIT_TESTNET')    || 'false';
    const ORDER_PORT       = Deno.env.get('ORDER_SERVER_PORT')|| '4001';
    const BASE44_TOKEN     = Deno.env.get('BASE44_USER_TOKEN')|| '';
    const BASE44_APP_URL   = Deno.env.get('BASE44_APP_URL')   || 'https://polytrade.base44.app';

    const missing = [];
    if (!BOT_SECRET)       missing.push('BOT_SECRET');
    if (!DROPLET_SECRET)   missing.push('DROPLET_SECRET');
    if (!BYBIT_API_KEY)    missing.push('BYBIT_API_KEY');
    if (!BYBIT_API_SECRET) missing.push('BYBIT_API_SECRET');
    if (!BASE44_TOKEN)     missing.push('BASE44_USER_TOKEN');
    if (missing.length) {
      return Response.json({ error: 'Missing secrets: ' + missing.join(', ') }, { status: 500 });
    }

    const envContent =
`BOT_SECRET=${BOT_SECRET}
DROPLET_SECRET=${DROPLET_SECRET}
BYBIT_API_KEY=${BYBIT_API_KEY}
BYBIT_API_SECRET=${BYBIT_API_SECRET}
BYBIT_TESTNET=${BYBIT_TESTNET}
ORDER_SERVER_PORT=${ORDER_PORT}
BASE44_USER_TOKEN=${BASE44_TOKEN}
BASE44_RESULT_URL=${BASE44_APP_URL}/functions/ingestTradeResult
BASE44_INGEST_URL=${BASE44_APP_URL}/functions/ingestSignal
BASE44_HEARTBEAT_URL=${BASE44_APP_URL}/functions/ingestHeartbeat
ALLOWED_PAIRS=BTCUSDT,ETHUSDT
ALLOWED_ASSETS=BTC,ETH
MIN_NET_EDGE_BPS=18
ALERT_EDGE_BPS=18
MIN_FILLABLE_USD=15
MAX_NOTIONAL_USD=20
MIN_CONFIDENCE=0.85
HARD_STALE_MS=20000
EXEC_TIMEOUT_MS=5000
PAIRS=BTC-USDT,ETH-USDT
`;

    // base64-encode so we don't have to escape quotes/special chars in the shell
    const b64 = btoa(envContent);

    const one_liner =
`mkdir -p /opt/arb-bot && cd /opt/arb-bot && echo "${b64}" | base64 -d > .env && chmod 600 .env && (test -f package.json || npm init -y >/dev/null) && (test -d node_modules/dotenv || npm install dotenv >/dev/null) && (pm2 delete order-server 2>/dev/null; pm2 start order-server.mjs --name order-server) && sleep 2 && curl -s http://localhost:4001/health && echo && curl -s -X POST http://localhost:4001/single-order -H "Content-Type: application/json" -d '{}' && echo`;

    const full_script =
`#!/bin/bash
set -e
echo "▶ Writing /opt/arb-bot/.env from Base44 secrets..."
mkdir -p /opt/arb-bot
cd /opt/arb-bot
echo "${b64}" | base64 -d > .env
chmod 600 .env
echo "✓ .env written ($(wc -l < .env) lines)"

echo "▶ Installing dotenv if missing..."
test -f package.json || npm init -y >/dev/null
test -d node_modules/dotenv || npm install dotenv

echo "▶ Restarting order-server under pm2..."
pm2 delete order-server 2>/dev/null || true
pm2 start order-server.mjs --name order-server
sleep 2

echo "▶ Health check:"
curl -s http://localhost:4001/health
echo ""
echo "▶ /single-order probe (should return 'unauthorized', NOT 'not_found'):"
curl -s -X POST http://localhost:4001/single-order -H "Content-Type: application/json" -d '{}'
echo ""
echo "✅ Done — order-server is now configured with BOT_SECRET and all required env."
`;

    return Response.json({
      message: 'Run the one-liner on the droplet to write /opt/arb-bot/.env with BOT_SECRET + all required secrets.',
      instructions: [
        'SSH to droplet: ssh root@<droplet-ip>',
        'Paste and run the one-liner below',
        'Expect /health = {"ok":true,...} and /single-order = {"error":"unauthorized"} (NOT not_found)',
        'Then click 💵 Place $6 Bybit Order in the Health page',
      ],
      one_liner,
      full_script,
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});