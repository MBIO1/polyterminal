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

    const ingestUrl    = `${baseUrl}/functions/ingestSignal`;
    const heartbeatUrl = `${baseUrl}/functions/ingestHeartbeat`;
    const resultUrl    = `${baseUrl}/functions/ingestTradeResult`;

    const script = `# ── PASTE THIS ENTIRE BLOCK INTO YOUR DROPLET SHELL ──

# 1. Write fresh .env
cat > /root/.env << 'ENVEOF'
DROPLET_SECRET=${dropletSecret}
BOT_SECRET=${dropletSecret}
BASE44_USER_TOKEN=${userToken}
BASE44_INGEST_URL=${ingestUrl}
BASE44_HEARTBEAT_URL=${heartbeatUrl}
BASE44_RESULT_URL=${resultUrl}
BASE44_APP_URL=${baseUrl}
BYBIT_API_KEY=${bybitKey}
BYBIT_API_SECRET=${bybitSecret}
BYBIT_TESTNET=false
ORDER_SERVER_PORT=${orderPort}
MIN_NET_EDGE_BPS=2
ALERT_EDGE_BPS=20
MIN_FILLABLE_USD=5
DISABLE_BINANCE=true
PAIRS=BTC-USDT,ETH-USDT,SOL-USDT,AVAX-USDT,ATOM-USDT
ENVEOF

# 2. Copy to known bot dirs
for D in /root/arb-ws-bot /opt/arb-bot /opt/base44-bot; do
  [ -d "$D" ] && cp /root/.env "$D/.env" && echo "copied to $D"
done

# 3. Write systemd overrides (fixes hardcoded tokens in service files)
for SVC in arb-bot arb-bot-v2 arb-base44-bot base44-bot; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^$SVC.service"; then
    mkdir -p "/etc/systemd/system/$SVC.service.d"
    cat > "/etc/systemd/system/$SVC.service.d/override.conf" << OVERRIDEEOF
[Service]
Environment="BASE44_USER_TOKEN=${userToken}"
Environment="DROPLET_SECRET=${dropletSecret}"
Environment="BOT_SECRET=${dropletSecret}"
Environment="BASE44_INGEST_URL=${ingestUrl}"
Environment="BASE44_HEARTBEAT_URL=${heartbeatUrl}"
Environment="BASE44_RESULT_URL=${resultUrl}"
Environment="BASE44_APP_URL=${baseUrl}"
Environment="BASE44_EMAIL=${Deno.env.get('BASE44_EMAIL') || ''}"
Environment="BASE44_PASSWORD=${Deno.env.get('BASE44_PASSWORD') || ''}"
OVERRIDEEOF
    echo "override written: $SVC"
  fi
done
systemctl daemon-reload

# 4. Restart ALL known services (systemd first, PM2 fallback)
RESTARTED=0
for SVC in arb-bot-v2 arb-bot arb-base44-bot base44-bot; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^$SVC.service"; then
    systemctl restart "$SVC" && echo "restarted $SVC"
    RESTARTED=$(( RESTARTED + 1 ))
  fi
done

if [ "$RESTARTED" -eq 0 ]; then
  if pm2 list 2>/dev/null | grep -qE 'arb|bot'; then
    pm2 restart all --update-env && echo "PM2: restarted all"
  else
    echo "WARNING: No bot found via systemd or PM2"
  fi
fi

echo ""
echo "Done! Check logs: journalctl -u arb-bot-v2 -n 40 --no-pager"`;

    const oneLiner = `sed -i "s|^DROPLET_SECRET=.*|DROPLET_SECRET=${dropletSecret}|;s|^BOT_SECRET=.*|BOT_SECRET=${dropletSecret}|;s|^BASE44_USER_TOKEN=.*|BASE44_USER_TOKEN=${userToken}|" /root/.env && systemctl restart arb-bot-v2 arb-bot arb-base44-bot base44-bot 2>/dev/null; pm2 restart all 2>/dev/null; echo done`;

    return Response.json({
      status: 'ready',
      one_liner: oneLiner,
      full_script: script,
      secret_first8: dropletSecret.slice(0, 8) + '...',
      instructions: [
        '1. SSH into droplet or open DigitalOcean console',
        '2. Paste the full_script block and press Enter',
        '3. Watch for "restarted arb-bot-v2" confirmation',
        '4. Check logs: journalctl -u arb-bot-v2 -n 40 --no-pager',
        '5. Signals should flow within 60 seconds',
      ],
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});