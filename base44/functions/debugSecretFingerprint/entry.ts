import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const droplet = Deno.env.get('DROPLET_SECRET') || '';
  const bot     = Deno.env.get('BOT_SECRET') || '';
  return Response.json({
    DROPLET_SECRET: {
      first8: droplet.slice(0, 8),
      last4:  droplet.slice(-4),
      length: droplet.length,
      has_whitespace: /\s/.test(droplet),
      has_quotes: /["']/.test(droplet),
    },
    BOT_SECRET: {
      first8: bot.slice(0, 8),
      last4:  bot.slice(-4),
      length: bot.length,
      has_whitespace: /\s/.test(bot),
      has_quotes: /["']/.test(bot),
    },
    secrets_match: droplet === bot,
  });
});