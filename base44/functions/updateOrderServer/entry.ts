// updateOrderServer — returns a shell one-liner the user runs on the droplet
// to pull the latest order-server.mjs from downloadOrderServer and restart the service.
//
// This is the simplest way to deploy the new /single-order endpoint without SSH automation.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const appUrl = Deno.env.get('BASE44_APP_URL') || 'https://polytrade.base44.app';
    const dropletIp = Deno.env.get('DROPLET_IP') || 'YOUR_DROPLET_IP';

    const oneLiner =
      `curl -fsSL ${appUrl}/functions/downloadOrderServer -o /opt/arb-bot/order-server.mjs && ` +
      `(systemctl restart order-server 2>/dev/null || pm2 restart order-server 2>/dev/null || ` +
      `(cd /opt/arb-bot && pm2 start order-server.mjs --name order-server)) && ` +
      `sleep 2 && curl -s http://localhost:4001/health`;

    const fullScript = `#!/bin/bash
set -e

echo "=== Pulling latest order-server.mjs from Base44 ==="
curl -fsSL ${appUrl}/functions/downloadOrderServer -o /opt/arb-bot/order-server.mjs
echo "✅ File downloaded ($(wc -l < /opt/arb-bot/order-server.mjs) lines)"

echo ""
echo "=== Restarting order-server ==="
if systemctl is-active --quiet order-server 2>/dev/null; then
  systemctl restart order-server
  echo "✅ Restarted via systemd"
elif pm2 list 2>/dev/null | grep -q order-server; then
  pm2 restart order-server
  echo "✅ Restarted via pm2"
else
  cd /opt/arb-bot && pm2 start order-server.mjs --name order-server
  echo "✅ Started via pm2 (first time)"
fi

sleep 2

echo ""
echo "=== Health check ==="
curl -s http://localhost:4001/health
echo ""

echo ""
echo "=== Done — /single-order endpoint should now be live ==="
`;

    return Response.json({
      status: 'ready',
      message: 'Update order-server to add /single-order endpoint for $1 Bybit test',
      one_liner: oneLiner,
      script: fullScript,
      instructions: [
        '1. SSH into your droplet: ssh root@' + dropletIp,
        '2. Run the one-liner above (or the full script)',
        '3. Verify /health responds with ok:true',
        '4. Then click "Place $1 Bybit Order" on the Health page',
      ],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});