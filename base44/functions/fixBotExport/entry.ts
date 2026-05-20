/**
 * Quick fix for bot.mjs export issue
 * Patches the CommonJS export to ES module export so runner.mjs can import it
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dropletIp = Deno.env.get('DROPLET_IP');

    // One-liner: idempotent — strips ALL existing exports (CJS block + any export default lines), then appends ONE clean ES export
    const oneLiner = `cd /root/arb-ws-bot && sed -i '/if (typeof module/,/^}$/d; /^export default /d' bot.mjs && echo 'export default ArbitrageEngine;' >> bot.mjs && tail -5 bot.mjs && pm2 restart arb-bot && sleep 3 && pm2 logs arb-bot --lines 20 --nostream`;

    const fullScript = `#!/bin/bash
set -e

echo "=== Fixing bot.mjs export (idempotent) ==="

cd /root/arb-ws-bot

# Backup current bot.mjs
cp bot.mjs bot.mjs.bak

# Strip BOTH the CommonJS export block AND any existing 'export default' lines
# (safe to run repeatedly without creating duplicate exports)
sed -i '/if (typeof module/,/^}$/d; /^export default /d' bot.mjs

# Append exactly one clean ES module export
echo "" >> bot.mjs
echo "export default ArbitrageEngine;" >> bot.mjs

echo "=== Last 5 lines of bot.mjs ==="
tail -5 bot.mjs

echo ""
echo "=== Restarting PM2 ==="
pm2 restart arb-bot

sleep 3

echo ""
echo "=== PM2 Status ==="
pm2 status

echo ""
echo "=== Last 30 log lines ==="
pm2 logs arb-bot --lines 30 --nostream

echo ""
echo "✅ Done — bot.mjs now uses ES module export"
`;

    return Response.json({
      status: 'ready',
      message: 'Fix bot.mjs export — converts CommonJS export to ES module default export',
      script: fullScript,
      one_liner: oneLiner,
      instructions: [
        '1. SSH into your droplet: ssh root@' + dropletIp,
        '2. Run the one-liner above (quick fix)',
        '3. Verify "online" + healthy uptime increasing in pm2 status',
        '4. Check logs for "✅ Signal posted" messages',
      ],
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});