import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

    const script = '#!/bin/bash\n' +
'set -e\n' +
'echo "=== STEP 1: Kill ALL PM2 processes ==="\n' +
'pm2 kill 2>/dev/null || true\n' +
'pm2 delete all 2>/dev/null || true\n' +
'\n' +
'echo "=== STEP 2: Stop ALL systemd bot services ==="\n' +
'for bot_svc in arb-bot arb-bot-v2 arb-base44-bot base44-bot trading-bot crypto-bot; do\n' +
'  systemctl stop "$bot_svc"    2>/dev/null && echo "Stopped $bot_svc"    || true\n' +
'  systemctl disable "$bot_svc" 2>/dev/null && echo "Disabled $bot_svc"   || true\n' +
'done\n' +
'\n' +
'echo "=== STEP 3: Remove stray bot directories (keep /root/arb-ws-bot) ==="\n' +
'for bot_dir in /opt/arb-bot /opt/base44-bot /opt/arb-bot-v2 /root/old-bot /root/arb-bot-backup; do\n' +
'  [ -d "$bot_dir" ] && rm -rf "$bot_dir" && echo "Removed $bot_dir" || true\n' +
'done\n' +
'\n' +
'echo "=== STEP 4: Write canonical /root/.env ==="\n' +
'cat > /root/.env << ENVEOF\n' +
'BASE44_USER_TOKEN=' + userToken + '\n' +
'BASE44_INGEST_URL=' + baseUrl + '/functions/ingestSignal\n' +
'BASE44_HEARTBEAT_URL=' + baseUrl + '/functions/ingestHeartbeat\n' +
'BASE44_RESULT_URL=' + baseUrl + '/functions/ingestTradeResult\n' +
'BASE44_APP_URL=' + baseUrl + '\n' +
'BOT_SECRET=' + dropletSecret + '\n' +
'BYBIT_API_KEY=' + bybitKey + '\n' +
'BYBIT_API_SECRET=' + bybitSecret + '\n' +
'BYBIT_TESTNET=false\n' +
'ORDER_SERVER_PORT=' + orderServerPort + '\n' +
'MIN_NET_EDGE_BPS=2\n' +
'ALERT_EDGE_BPS=20\n' +
'MIN_FILLABLE_USD=50\n' +
'PAIRS=BTC-USDT,ETH-USDT,SOL-USDT,BNB-USDT,AVAX-USDT,ATOM-USDT\n' +
'ENVEOF\n' +
'chmod 600 /root/.env\n' +
'echo "✅ /root/.env written and locked"\n' +
'\n' +
'echo "=== STEP 5: Write systemd overrides (ensure correct env even if hardcoded) ==="\n' +
'for svc_name in arb-base44-bot base44-bot; do\n' +
'  if systemctl list-unit-files 2>/dev/null | grep -q "^${svc_name}.service"; then\n' +
'    mkdir -p /etc/systemd/system/${svc_name}.service.d\n' +
'    printf \'[Service]\\nEnvironment="BASE44_USER_TOKEN=' + userToken + '"\\nEnvironment="BOT_SECRET=' + dropletSecret + '"\\nEnvironment="BASE44_INGEST_URL=' + baseUrl + '/functions/ingestSignal"\\nEnvironment="BASE44_HEARTBEAT_URL=' + baseUrl + '/functions/ingestHeartbeat"\\n\' > /etc/systemd/system/${svc_name}.service.d/override.conf\n' +
'    echo "override written for ${svc_name}"\n' +
'  fi\n' +
'done\n' +
'systemctl daemon-reload\n' +
'echo "✅ systemd overrides installed"\n' +
'\n' +
'echo "=== STEP 6: Copy env to bot directory ==="\n' +
'cp /root/.env /root/arb-ws-bot/.env 2>/dev/null && chmod 600 /root/arb-ws-bot/.env && echo "✅ copied to /root/arb-ws-bot" || true\n' +
'\n' +
'echo "=== STEP 7: Ensure PM2 is installed ==="\n' +
'which pm2 || npm install -g pm2\n' +
'\n' +
'echo "=== STEP 8: Start ONLY the Base44 arb-bot under PM2 ==="\n' +
'cd /root/arb-ws-bot\n' +
'\n' +
'BOT_FILE="bot.mjs"\n' +
'[ ! -f "$BOT_FILE" ] && BOT_FILE="bot.js"\n' +
'[ ! -f "$BOT_FILE" ] && BOT_FILE="index.mjs"\n' +
'[ ! -f "$BOT_FILE" ] && BOT_FILE="index.js"\n' +
'echo "Using entrypoint: $BOT_FILE"\n' +
'\n' +
'pm2 start "$BOT_FILE" --name arb-bot --env production \\\n' +
'  --log /var/log/arb-bot.log \\\n' +
'  --error /var/log/arb-bot-error.log \\\n' +
'  --time\n' +
'\n' +
'pm2 save\n' +
'pm2 startup systemd -u root --hp /root 2>/dev/null | grep "sudo" | bash || true\n' +
'\n' +
'echo ""\n' +
'echo "=== PM2 Status ==="\n' +
'pm2 status\n' +
'echo ""\n' +
'echo "=== Last 20 log lines ==="\n' +
'sleep 2\n' +
'pm2 logs arb-bot --lines 20 --nostream\n' +
'echo ""\n' +
'echo "✅ Done! Only Base44 arb-bot is running."\n' +
'echo "   Monitor: pm2 logs arb-bot"\n';

    return Response.json({
      status: 'ready',
      message: 'Script will kill all other bots, clean env, and restart only the Base44 arb-bot under PM2',
      script,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});