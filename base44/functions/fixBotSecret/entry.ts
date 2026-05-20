// Patches /root/arb-ws-bot/.env so BOT_SECRET == DROPLET_SECRET (the value Base44 actually checks).
// Returns a single safe one-liner the user runs on the droplet.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    if (!dropletSecret) {
      return Response.json({ error: 'DROPLET_SECRET not set in Base44 env' }, { status: 500 });
    }

    // Base64-encode the secret to avoid any shell escaping issues with special chars
    const b64 = btoa(dropletSecret);

    // Single safe one-liner: decode secret, rewrite BOT_SECRET line atomically, restart PM2 with --update-env
    const oneLiner =
`SECRET=$(echo '${b64}' | base64 -d) && \
sed -i '/^BOT_SECRET=/d' /root/arb-ws-bot/.env && \
echo "BOT_SECRET=$SECRET" >> /root/arb-ws-bot/.env && \
sed -i '/^DROPLET_SECRET=/d' /root/arb-ws-bot/.env && \
echo "DROPLET_SECRET=$SECRET" >> /root/arb-ws-bot/.env && \
pm2 restart arb-bot --update-env && \
sleep 6 && \
pm2 logs arb-bot --lines 40 --nostream | grep -E "Signal posted|non2xx|401|Unauthorized" | tail -10`;

    return Response.json({
      status: 'ready',
      message: 'Run this ONE command on the droplet — it rewrites BOT_SECRET to match Base44 and restarts the bot.',
      one_liner: oneLiner,
      secret_fingerprint: dropletSecret.slice(0, 8) + '...' + dropletSecret.slice(-4),
      secret_length: dropletSecret.length,
      instructions: [
        '1. SSH into droplet (or use the DigitalOcean web console).',
        '2. Paste the one_liner above and hit Enter.',
        '3. After ~6s you should see "Signal posted" lines — no more 401s.',
      ],
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});