import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const s = Deno.env.get('DROPLET_SECRET') || '';
  return Response.json({
    first8: s.slice(0, 8),
    length: s.length,
    has_whitespace: /\s/.test(s),
    has_quotes: /["']/.test(s),
  });
});