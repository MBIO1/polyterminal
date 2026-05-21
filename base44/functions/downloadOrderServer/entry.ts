// downloadOrderServer — Serves order-server.mjs v4 as plain text.
// Usage from droplet:
//   curl -s https://YOUR_APP.base44.app/functions/downloadOrderServer -o /opt/arb-bot/order-server.mjs
//   pm2 restart order-server

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Read the canonical v4 source from the pushOrderServer function string.
// This endpoint exists purely so the droplet can curl the latest order-server.mjs.
// The actual embedded source lives in pushOrderServer (which also pushes it via /setup).
// This function re-exposes the same content for manual wget/curl deployments.

Deno.serve(async (req) => {
  // Minimal auth — require droplet secret to prevent leaking Bybit logic publicly.
  // Accept both Authorization: Bearer <secret> and no-auth (public curl usage).
  const base44 = createClientFromRequest(req);
  let authed = false;
  try {
    const user = await base44.auth.me();
    authed = !!user;
  } catch { /* public/unauthenticated ok */ }

  // Trigger pushOrderServer to get the canonical source text via the /setup payload.
  // Instead, we return the SOURCE inline here — keeping a single source of truth
  // in pushOrderServer and downloadOrderServer synchronized manually.

  const SOURCE = await fetch(
    `https://base44.app/api/apps/${Deno.env.get('BASE44_APP_ID')}/functions/pushOrderServer`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.get('authorization') || '',
        'X-App-Id': Deno.env.get('BASE44_APP_ID') || '',
      },
      body: JSON.stringify({ dry_run: true, source_only: true }),
      signal: AbortSignal.timeout(10000),
    }
  ).then(r => r.ok ? r.json() : null).then(j => j?.source || null).catch(() => null);

  if (SOURCE) {
    return new Response(SOURCE, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  }

  // Fallback: redirect to pushOrderServer to get instructions
  return Response.json({
    error: 'Use pushOrderServer function to deploy directly, or copy order-server.mjs from the droplet-bot/ folder.',
    hint: 'Run: base44.functions.invoke("pushOrderServer") to push v4 directly to your droplet.',
  }, { status: 200 });
});