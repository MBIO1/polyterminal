// Returns a diagnostic one-liner the user runs on the droplet to reveal:
//   1. Which file PM2 is actually running
//   2. The first/last 8 chars of BOT_SECRET inside that process (via /proc/PID/environ)
//   3. The expected DROPLET_SECRET fingerprint from Base44

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dropletSecret = Deno.env.get('DROPLET_SECRET') || '';
    const fp = dropletSecret.slice(0, 8) + '...' + dropletSecret.slice(-8);

    const oneLiner =
`echo "=== PM2 process info ===" && \
pm2 jlist | python3 -c "import sys,json; d=[p for p in json.load(sys.stdin) if p['name']=='arb-bot'][0]; print('script:',d['pm2_env']['pm_exec_path']); print('cwd:',d['pm2_env']['pm_cwd']); print('pid:',d['pid'])" && \
echo "" && echo "=== BOT_SECRET inside arb-bot process ===" && \
PID=$(pm2 jlist | python3 -c "import sys,json; print([p['pid'] for p in json.load(sys.stdin) if p['name']=='arb-bot'][0])") && \
tr '\\0' '\\n' < /proc/$PID/environ | grep -E "^(BOT_SECRET|DROPLET_SECRET|BASE44_INGEST_URL)=" | sed 's/=\\(.\\{8\\}\\).*\\(.\\{8\\}\\)$/=\\1...\\2/' && \
echo "" && echo "=== Expected (from Base44) ===" && \
echo "DROPLET_SECRET=${fp}" && \
echo "" && echo "=== .env file BOT_SECRET ===" && \
grep -E "^(BOT_SECRET|DROPLET_SECRET|BASE44_INGEST_URL)=" /root/arb-ws-bot/.env | sed 's/=\\(.\\{8\\}\\).*\\(.\\{8\\}\\)$/=\\1...\\2/' && \
echo "" && echo "=== Live curl test (using .env BOT_SECRET) ===" && \
source /root/arb-ws-bot/.env && \
curl -s -o /tmp/resp -w "HTTP %{http_code}\\n" -X POST "$BASE44_INGEST_URL" \
  -H "Authorization: Bearer $BOT_SECRET" -H "Content-Type: application/json" \
  -d '{"pair":"TEST-USDT","buy_exchange":"X","sell_exchange":"Y","raw_spread_bps":10,"net_edge_bps":5,"buy_price":1,"sell_price":1.0005}' && \
cat /tmp/resp && echo`;

    return Response.json({
      status: 'ready',
      expected_secret_fingerprint: fp,
      one_liner: oneLiner,
      instructions: ['Paste the one_liner on the droplet — output will reveal exactly what BOT_SECRET the running process is using vs what Base44 expects.'],
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});