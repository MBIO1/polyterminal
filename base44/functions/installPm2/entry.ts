import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Generates a PM2 setup script for the droplet — installs PM2,
// stops old systemd services, and starts bots under PM2 management.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const userToken = Deno.env.get('BASE44_USER_TOKEN');
    const baseUrl = Deno.env.get('BASE44_APP_URL');
    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const orderServerPort = Deno.env.get('ORDER_SERVER_PORT') || '4001';
    const bybitKey = Deno.env.get('BYBIT_API_KEY');
    const bybitSecret = Deno.env.get('BYBIT_API_SECRET');

    const script = `#!/bin/bash
set -e
echo "=== Installing PM2 ==="
npm install -g pm2

echo "=== Stopping old systemd services ==="
for SVC in arb-bot arb-bot-v2 arb-base44-bot base44-bot; do
  systemctl stop "$SVC" 2>/dev/null && systemctl disable "$SVC" 2>/dev/null && echo "Stopped $SVC" || echo "Skipped $SVC"
done
# Keep order-server under systemd (it's a server, not a bot)

echo "=== Writing canonical /root/.env ==="
cat > /root/.env << 'EOF'
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
EOF

echo "=== Starting bot under PM2 ==="
# Stop any existing PM2 bot processes
pm2 delete arb-bot 2>/dev/null || true

# Start the main WS bot
cd /root
pm2 start bot.mjs --name arb-bot --env production \\
  --log /var/log/arb-bot.log \\
  --error /var/log/arb-bot-error.log \\
  --time

# Save PM2 process list and enable startup
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash

echo "=== PM2 Status ==="
pm2 status
echo ""
echo "=== Useful commands ==="
echo "  pm2 logs arb-bot       # live logs"
echo "  pm2 restart arb-bot    # restart"
echo "  pm2 monit              # dashboard"
echo ""
echo "Done!"
`;

    return Response.json({
      status: 'ready',
      message: 'Run this script on your droplet to install PM2 and migrate the bot',
      script,
      instructions: [
        '1. Copy the script below',
        '2. On the droplet: nano /root/setup-pm2.sh  (paste, save)',
        '3. chmod +x /root/setup-pm2.sh && bash /root/setup-pm2.sh',
        '4. Verify: pm2 status && pm2 logs arb-bot --lines 20',
      ],
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});