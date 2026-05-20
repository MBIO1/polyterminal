import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Generates a cleanup script that:
// 1. Kills all PM2 processes and systemd bot services
// 2. Deletes all other bots, keeps only the Base44 arb-bot
// 3. Rewrites /root/.env with fresh secrets
// 4. Restarts under PM2 with only the Base44 bot

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const userToken       = Deno.env.get('BASE44_USER_TOKEN');
    const baseUrl         = Deno.env.get('BASE44_APP_URL');
    const dropletSecret   = Deno.env.get('DROPLET_SECRET');
    const orderServerPort = Deno.env.get('ORDER_SERVER_PORT') || '4001';
    const bybitKey        = Deno.env.get('BYBIT_API_KEY');
    const bybitSecret     = Deno.env.get('BYBIT_API_SECRET');

    const script = `#!/bin/bash
set -e
echo "=== STEP 1: Kill ALL PM2 processes ==="
pm2 kill 2>/dev/null || true
pm2 delete all 2>/dev/null || true

echo "=== STEP 2: Stop ALL systemd bot services ==="
for SVC in arb-bot arb-bot-v2 arb-base44-bot base44-bot trading-bot crypto-bot; do
  systemctl stop "$SVC"    2>/dev/null && echo "Stopped $SVC"    || true
  systemctl disable "$SVC" 2>/dev/null && echo "Disabled $SVC"   || true
done

echo "=== STEP 3: Remove stray bot directories (keep /root/arb-ws-bot) ==="
for DIR in /opt/arb-bot /opt/base44-bot /opt/arb-bot-v2 /root/old-bot /root/arb-bot-backup; do
  [ -d "$DIR" ] && rm -rf "$DIR" && echo "Removed $DIR" || true
done

echo "=== STEP 4: Write canonical /root/.env ==="
cat > /root/.env << 'ENVEOF'
BASE44_USER_TOKEN=${userToken}
BASE44_INGEST_URL=${baseUrl}/functions/ingestSignal
BASE44_HEARTBEAT_URL=${baseUrl}/functions/ingestHeartbeat
BASE44_RESULT_URL=${baseUrl}/functions/ingestTradeResult
BASE44_APP_URL=${baseUrl}
BOT_SECRET=${dropletSecret}
BYBIT_API_KEY=${bybitKey}
BYBIT_API_SECRET=${bybitSecret}
BYBIT_TESTNET=false
ORDER_SERVER_PORT=${orderServerPort}
MIN_NET_EDGE_BPS=2
ALERT_EDGE_BPS=20
MIN_FILLABLE_USD=50
PAIRS=BTC-USDT,ETH-USDT,SOL-USDT,BNB-USDT,AVAX-USDT,ATOM-USDT
ENVEOF
chmod 600 /root/.env
echo "✅ /root/.env written and locked"

echo "=== STEP 5: Write systemd overrides (ensure correct env even if hardcoded) ==="
for SVC in arb-base44-bot base44-bot; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^${SVC}.service"; then
    mkdir -p /etc/systemd/system/${SVC}.service.d
    printf '[Service]\\nEnvironment="BASE44_USER_TOKEN=${userToken}"\\nEnvironment="BOT_SECRET=${dropletSecret}"\\nEnvironment="BASE44_INGEST_URL=${baseUrl}/functions/ingestSignal"\\nEnvironment="BASE44_HEARTBEAT_URL=${baseUrl}/functions/ingestHeartbeat"\\n' > /etc/systemd/system/${SVC}.service.d/override.conf
    echo "override written for ${SVC}"
  fi
done
systemctl daemon-reload
echo "✅ systemd overrides installed"

echo "=== STEP 6: Copy env to bot directory ==="
cp /root/.env /root/arb-ws-bot/.env 2>/dev/null && chmod 600 /root/arb-ws-bot/.env && echo "✅ copied to /root/arb-ws-bot" || true

echo "=== STEP 7: Ensure PM2 is installed ==="
which pm2 || npm install -g pm2

echo "=== STEP 8: Start ONLY the Base44 arb-bot under PM2 ==="
cd /root/arb-ws-bot

# Pick the right entrypoint (bot.mjs preferred)
BOT_FILE="bot.mjs"
[ ! -f "$BOT_FILE" ] && BOT_FILE="bot.js"
[ ! -f "$BOT_FILE" ] && BOT_FILE="index.mjs"
[ ! -f "$BOT_FILE" ] && BOT_FILE="index.js"
echo "Using entrypoint: $BOT_FILE"

pm2 start "$BOT_FILE" --name arb-bot --env production \\
  --log /var/log/arb-bot.log \\
  --error /var/log/arb-bot-error.log \\
  --time

pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null | grep "sudo" | bash || true

echo ""
echo "=== PM2 Status ==="
pm2 status
echo ""
echo "=== Last 20 log lines ==="
sleep 2
pm2 logs arb-bot --lines 20 --nostream
echo ""
echo "✅ Done! Only Base44 arb-bot is running."
echo "   Monitor: pm2 logs arb-bot"
`;

    return Response.json({
      status: 'ready',
      message: 'Script will kill all other bots, clean env, and restart only the Base44 arb-bot under PM2',
      script,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});