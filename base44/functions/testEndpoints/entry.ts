/**
 * testEndpoints — check which Polymarket API endpoints are reachable from Deno Deploy
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const endpoints = [
    { name: 'CLOB /time',          url: 'https://clob.polymarket.com/time' },
    { name: 'CLOB /markets',       url: 'https://clob.polymarket.com/markets?limit=3' },
    { name: 'CLOB /order-book',    url: 'https://clob.polymarket.com/book?token_id=21742633143463906290569050155826241533067272736897614950488156847949938836455' },
    { name: 'Gamma markets',       url: 'https://gamma-api.polymarket.com/markets?limit=3' },
    { name: 'Gamma events',        url: 'https://gamma-api.polymarket.com/events?limit=3' },
    { name: 'Strapi API',          url: 'https://strapi-matic.poly.market/markets?_limit=3' },
    { name: 'polymarket.com',      url: 'https://polymarket.com' },
  ];

  const results = await Promise.allSettled(
    endpoints.map(async ({ name, url }) => {
      const start = Date.now();
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.text();
      return {
        name,
        url,
        status: res.status,
        ok: res.ok,
        latency_ms: Date.now() - start,
        body_preview: body.slice(0, 120),
      };
    })
  );

  return Response.json(results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { name: endpoints[i].name, url: endpoints[i].url, error: r.reason?.message }
  ));
});