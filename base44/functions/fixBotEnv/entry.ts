import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Fixes the BASE44_USER_TOKEN in /root/.env and all bot .env files on the droplet
// then restarts all arb bot services

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dropletIp = Deno.env.get('DROPLET_IP');
    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const orderServerPort = Deno.env.get('ORDER_SERVER_PORT') || '4001';
    const userToken = Deno.env.get('BASE44_USER_TOKEN');
    const baseUrl = Deno.env.get('BASE44_APP_URL');

    if (!dropletIp || !dropletSecret || !userToken || !baseUrl) {
      return Response.json({ error: 'Missing required secrets' }, { status: 500 });
    }

    // Send the correct env vars to the droplet via order-server
    const response = await fetch(`http://${dropletIp}:${orderServerPort}/api/fix-env`, {
      method: 'POST',
      headers: {
        'X-Droplet-Secret': dropletSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        envFiles: [
          '/root/.env',
          '/opt/arb-bot/.env',
          '/opt/base44-bot/.env',
        ],
        vars: {
          BASE44_USER_TOKEN: userToken,
          BASE44_INGEST_URL: `${baseUrl}/functions/ingestSignal`,
          BASE44_HEARTBEAT_URL: `${baseUrl}/functions/ingestHeartbeat`,
          BASE44_RESULT_URL: `${baseUrl}/functions/ingestTradeResult`,
          BASE44_APP_URL: baseUrl,
        },
        restartServices: ['arb-bot-v2', 'arb-bot', 'arb-base44-bot', 'base44-bot'],
      }),
    });

    if (!response.ok) {
      // Fallback: return a shell script for manual execution
      const script = `#!/bin/bash
# Fix BASE44_USER_TOKEN in all bot env files and restart services
TOKEN="${userToken}"
INGEST_URL="${baseUrl}/functions/ingestSignal"
HEARTBEAT_URL="${baseUrl}/functions/ingestHeartbeat"
RESULT_URL="${baseUrl}/functions/ingestTradeResult"

for ENV_FILE in /root/.env /opt/arb-bot/.env /opt/base44-bot/.env; do
  if [ -f "$ENV_FILE" ]; then
    echo "Updating $ENV_FILE..."
    sed -i "s|^BASE44_USER_TOKEN=.*|BASE44_USER_TOKEN=$TOKEN|" "$ENV_FILE"
    grep -q "BASE44_INGEST_URL" "$ENV_FILE" || echo "BASE44_INGEST_URL=$INGEST_URL" >> "$ENV_FILE"
    grep -q "BASE44_HEARTBEAT_URL" "$ENV_FILE" || echo "BASE44_HEARTBEAT_URL=$HEARTBEAT_URL" >> "$ENV_FILE"
  fi
done

# Update systemd override for arb-base44-bot (has hardcoded wrong token)
mkdir -p /etc/systemd/system/arb-base44-bot.service.d
cat > /etc/systemd/system/arb-base44-bot.service.d/override.conf << EOF
[Service]
Environment="BASE44_USER_TOKEN=$TOKEN"
Environment="BASE44_INGEST_URL=$INGEST_URL"
Environment="BASE44_HEARTBEAT_URL=$HEARTBEAT_URL"
EOF

systemctl daemon-reload
for SVC in arb-bot-v2 arb-bot arb-base44-bot base44-bot; do
  systemctl restart "$SVC" 2>/dev/null && echo "Restarted $SVC" || echo "Skipped $SVC"
done
echo "Done. Check logs: journalctl -u arb-bot-v2 -f"
`;

      return Response.json({
        status: 'manual_required',
        message: 'Order server endpoint not available — run the script below on your droplet',
        script,
      });
    }

    const result = await response.json();
    return Response.json({ status: 'fixed', result });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});