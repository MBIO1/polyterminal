/**
 * Generates a script to permanently disable the legacy arb-bot.service (systemd)
 * which is in a crash loop due to missing BASE44_INGEST_URL/BASE44_EMAIL env vars.
 * The current bot runs under PM2, not systemd.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const userToken = Deno.env.get('BASE44_USER_TOKEN');
    const botSecret = Deno.env.get('BOT_SECRET') || Deno.env.get('DROPLET_SECRET');
    const baseUrl   = Deno.env.get('BASE44_APP_URL');
    const bybitKey  = Deno.env.get('BYBIT_API_KEY');
    const bybitSec  = Deno.env.get('BYBIT_API_SECRET');
    const port      = Deno.env.get('ORDER_SERVER_PORT') || '4001';

    const fullScript = `#!/bin/bash
set -e
echo "=== 🔧 Killing legacy systemd arb-bot.service ==="

# 1. Stop and disable the broken systemd service (the crash loop)
systemctl stop arb-bot.service 2>/dev/null || true
systemctl disable arb-bot.service 2>/dev/null || true
systemctl mask arb-bot.service 2>/dev/null || true
rm -f /etc/systemd/system/arb-bot.service
rm -f /etc/systemd/system/multi-user.target.wants/arb-bot.service
systemctl daemon-reload
systemctl reset-failed
echo "✅ systemd arb-bot.service killed & masked"

# 2. Kill any stray node processes from systemd
pkill -9 -f "node.*runner" 2>/dev/null || true
pkill -9 -f "node.*bot.mjs" 2>/dev/null || true
sleep 1
echo "✅ stray processes killed"

# 3. Rewrite .env with correct PM2-compatible env vars
cat > /root/.env << 'ENVEOF'
BASE44_USER_TOKEN=${userToken}
BASE44_INGEST_URL=${baseUrl}/functions/ingestSignal
BASE44_HEARTBEAT_URL=${baseUrl}/functions/ingestHeartbeat
BASE44_RESULT_URL=${baseUrl}/functions/ingestTradeResult
BASE44_APP_URL=${baseUrl}
BOT_SECRET=${botSecret}
BYBIT_API_KEY=${bybitKey}
BYBIT_API_SECRET=${bybitSec}
BYBIT_TESTNET=false
ORDER_SERVER_PORT=${port}
MIN_NET_EDGE_BPS=20
MIN_FILLABLE_USD=500
PAIRS=BTC-USDT,ETH-USDT,SOL-USDT,BNB-USDT,AVAX-USDT,ATOM-USDT
ENVEOF
chmod 600 /root/.env
cp /root/.env /root/arb-ws-bot/.env 2>/dev/null || true
chmod 600 /root/arb-ws-bot/.env 2>/dev/null || true
echo "✅ .env rewritten"

# 4. Restart bot via PM2 (the ONLY manager going forward)
cd /root/arb-ws-bot
pm2 delete arb-bot 2>/dev/null || true
pm2 start runner.mjs --name arb-bot --update-env \\
  --log /var/log/arb-bot.log \\
  --error /var/log/arb-bot-error.log \\
  --time
pm2 save
echo ""
echo "=== ✅ Done — bot now managed by PM2 only ==="
pm2 status
echo ""
echo "Tail logs: pm2 logs arb-bot --lines 30"`;

    const oneLiner = `systemctl stop arb-bot.service; systemctl disable arb-bot.service; systemctl mask arb-bot.service; rm -f /etc/systemd/system/arb-bot.service; systemctl daemon-reload; systemctl reset-failed; pkill -9 -f "node.*runner"; cd /root/arb-ws-bot && pm2 delete arb-bot 2>/dev/null; pm2 start runner.mjs --name arb-bot --update-env && pm2 save && pm2 logs arb-bot --lines 20`;

    return Response.json({
      status: 'ready',
      message: '⚠️ A legacy systemd service is crash-looping (1300+ restarts). It needs different env vars than the current PM2 bot. This script disables systemd and restarts the bot under PM2 only.',
      one_liner: oneLiner,
      full_script: fullScript,
      instructions: [
        '1. SSH into the droplet: ssh root@<droplet-ip>',
        '2. Paste the FULL SCRIPT (one-liner may miss env rewrite)',
        '3. Wait ~5 seconds for PM2 to start',
        '4. Verify: pm2 status — should show arb-bot "online"',
        '5. Refresh the Health page — heartbeat should resume within 60s',
      ],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});