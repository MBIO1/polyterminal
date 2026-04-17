/**
 * polyTestConnection — tests CLOB public reachability and confirms credentials are set.
 * NOTE: Polymarket's authenticated endpoints (orders, trades) are geo-blocked from US servers.
 * This function verifies: (1) CLOB is reachable via public /time endpoint, (2) all creds are set.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CLOB_BASE = 'https://clob.polymarket.com';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey        = Deno.env.get('POLY_API_KEY');
  const apiSecret     = Deno.env.get('POLY_API_SECRET');
  const passphrase    = Deno.env.get('POLY_API_PASSPHRASE');
  const walletAddress = Deno.env.get('POLY_WALLET_ADDRESS');
  const privateKey    = Deno.env.get('POLY_PRIVATE_KEY');

  const allSet = !!(apiKey && apiSecret && passphrase && walletAddress && privateKey);

  // Route via Oxylabs Web Unblocker (reverse-proxy API — works in sandboxed Deno)
  // Instead of CONNECT tunneling, we POST the target URL to Oxylabs' scraper API
  // which fetches it from a residential German IP and returns the response body.
  const oxyUser = Deno.env.get('OXYLABS_USER');
  const oxyPass = Deno.env.get('OXYLABS_PASS');
  const proxyUsed = !!(oxyUser && oxyPass);
  const oxyAuth = proxyUsed ? btoa(`${oxyUser}:${oxyPass}`) : null;

  async function proxyGet(targetUrl) {
    if (!proxyUsed) {
      return fetch(targetUrl, { signal: AbortSignal.timeout(8000) });
    }
    // Oxylabs Scraper API — fetches the URL from a DE residential IP
    const res = await fetch('https://realtime.oxylabs.io/v1/queries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${oxyAuth}`,
      },
      body: JSON.stringify({
        source: 'universal',
        url: targetUrl,
        geo_location: 'Germany',
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Oxylabs API error: ${res.status}`);
    const data = await res.json();
    const content = data?.results?.[0]?.content;
    if (!content) throw new Error('No content from Oxylabs');
    // Return a mock Response-like object
    return { ok: true, json: async () => JSON.parse(content), text: async () => content };
  }

  // Test public CLOB reachability via proxy
  let clobReachable = false;
  let serverTime = null;
  let clobError = null;
  try {
    const timeRes = await proxyGet(`${CLOB_BASE}/time`);
    if (timeRes.ok) {
      serverTime = await timeRes.json();
      clobReachable = true;
    }
  } catch (e) {
    clobError = e.message;
  }

  // Test fee-rate endpoint
  let priceApiOk = false;
  let feeError = null;
  try {
    const feeRes = await proxyGet(`${CLOB_BASE}/fee-rate`);
    priceApiOk = feeRes.ok;
  } catch (e) {
    feeError = e.message;
  }

  return Response.json({
    ok: clobReachable && allSet,
    clobReachable,
    priceApiOk,
    allCredsSet: allSet,
    address: walletAddress,
    serverTime,
    proxyUsed,
    clobError,
    feeError,
    note: proxyUsed ? 'Routing via Oxylabs Web Unblocker (Germany residential IP)' : 'No proxy configured',
  });
});