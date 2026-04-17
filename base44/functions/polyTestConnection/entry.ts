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

  // Test public CLOB reachability
  let clobReachable = false;
  let serverTime = null;
  try {
    const timeRes = await fetch(`${CLOB_BASE}/time`, { signal: AbortSignal.timeout(5000) });
    if (timeRes.ok) {
      serverTime = await timeRes.json();
      clobReachable = true;
    }
  } catch (_) {
    clobReachable = false;
  }

  // Test public price endpoint (no token needed - just check the endpoint responds)
  let priceApiOk = false;
  try {
    const feeRes = await fetch(`${CLOB_BASE}/fee-rate`, { signal: AbortSignal.timeout(5000) });
    priceApiOk = feeRes.ok;
  } catch (_) {
    priceApiOk = false;
  }

  return Response.json({
    ok: clobReachable && allSet,
    clobReachable,
    priceApiOk,
    allCredsSet: allSet,
    address: walletAddress,
    serverTime,
    note: 'Polymarket authenticated endpoints (orders/trades) require non-US IP. Use a VPN or offshore server for live trading.',
  });
});