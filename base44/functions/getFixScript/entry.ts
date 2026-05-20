// Returns a one-liner shell command to fix the droplet .env instantly.
// The bot's DROPLET_SECRET must match what Base44 has stored.
// Run the printed command directly on the droplet (SSH or DigitalOcean console).

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const userToken     = Deno.env.get('BASE44_USER_TOKEN');
    const baseUrl       = Deno.env.get('BASE44_APP_URL');
    const bybitKey      = Deno.env.get('BYBIT_API_KEY');
    const bybitSecret   = Deno.env.get('BYBIT_API_SECRET');
    const orderPort     = Deno.env.get('ORDER_SERVER_PORT') || '4001';

    if (!dropletSecret || !userToken || !baseUrl) {
      return Response.json({ error: 'Missing required secrets' }, { status: 500 });
    }

    // Generate a self-contained heredoc that rewrites the env and restarts
    const script = `
# ── PASTE THIS ENTIRE BLOCK INTO YOUR DROPLET SHELL ──
cat > /root/.env << 'EOF'
DROPLET_SECRET=${dropletSecret}
BOT_SECRET=${dropletSecret}
BASE44_USER_TOKEN=${userToken}
BASE44_INGEST_URL=${baseUrl}/functions/ingestSignal
BASE44_HEARTBEAT_URL=${baseUrl}/functions/ingestHeartbeat
BASE44_RESULT_URL=${baseUrl}/functions/ingestTradeResult
BASE44_APP_URL=${baseUrl}
BYBIT_API_KEY=${bybitKey}
BYBIT_API_SECRET=${bybitSecret}
BYBIT_TESTNET=false
ORDER_SERVER_PORT=${orderPort}
MIN_NET_EDGE_BPS=2
ALERT_EDGE_BPS=20
MIN_FILLABLE_USD=50
DISABLE_BINANCE=true
PAIRS=BTC-USDT,ETH-USDT,SOL-USDT,AVAX-USDT,ATOM-USDT
EOF

# Copy to all known bot dirs
for D in /root/arb-ws-bot /opt/arb-bot /opt/base44-bot; do
  [ -d "$D" ] && cp /root/.env "$D/.env" && echo "✅ copied to $D"
done

# Restart bot (PM2 preferred, systemd fallback)
if pm2 list 2>/dev/null | grep -q arb-bot; then
  pm2 restart arb-bot && echo "✅ PM2 arb-bot restarted"
elif pm2 list 2>/dev/null | grep -q .; then
  pm2 restart all && echo "✅ PM2 all restarted"
else
  for SVC in arb-bot arb-bot-v2 arb-base44-bot base44-bot; do
    systemctl is-active --quiet "$SVC" && systemctl restart "$SVC" && echo "✅ restarted $SVC" && break
  done
fi

echo ""
echo "Done! Check logs: pm2 logs arb-bot --lines 30"
`.trim();

    // Also generate a verified one-liner for quick copy
    const oneLiner = `sed -i "s|^DROPLET_SECRET=.*|DROPLET_SECRET=${dropletSecret}|;s|^BOT_SECRET=.*|BOT_SECRET=${dropletSecret}|" /root/.env && pm2 restart arb-bot 2>/dev/null || systemctl restart arb-bot`;

    return Response.json({
      status: 'ready',
      one_liner: oneLiner,
      full_script: script,
      secret_first8: dropletSecret.slice(0, 8) + '...',
      instructions: [
        '1. Open your droplet terminal (SSH or DigitalOcean console)',
        '2. Paste the full_script block and press Enter',
        '3. Watch for ✅ confirmation lines',
        '4. After restart, check: pm2 logs arb-bot --lines 20',
        '5. Signals should flow within 60 seconds',
      ],
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});