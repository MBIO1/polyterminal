/**
 * testClobAuth — Full Polymarket auth flow (confirmed spec from official docs)
 *
 * L1: EIP-712 chainId=137, GET /auth/derive-api-key (not POST, not GET /auth/api-key)
 * L2: HMAC-SHA256, path only (no query string), headers: POLY_ADDRESS, POLY_SIGNATURE, POLY_TIMESTAMP, POLY_API_KEY, POLY_PASSPHRASE
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { ethers } from 'npm:ethers@6.13.0';

const MSG_TO_SIGN = "This message attests that I control the given wallet";
const L1_DOMAIN   = { name: 'ClobAuthDomain', version: '1', chainId: 137 };
const L1_TYPES    = {
  ClobAuth: [
    { name: 'address',   type: 'address' },
    { name: 'timestamp', type: 'string'  },
    { name: 'nonce',     type: 'uint256' },
    { name: 'message',   type: 'string'  },
  ],
};

async function hmacSign(secret, ts, method, path, body = '') {
  const msg = `${ts}${method.toUpperCase()}${path}${body}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const privateKey = Deno.env.get('POLY_PRIVATE_KEY');
  const walletAddr = Deno.env.get('POLY_WALLET_ADDRESS');
  const storedApiKey     = Deno.env.get('POLY_API_KEY');
  const storedApiSecret  = Deno.env.get('POLY_API_SECRET');
  const storedPassphrase = Deno.env.get('POLY_API_PASSPHRASE');

  if (!privateKey || !walletAddr) return Response.json({ error: 'Missing POLY_PRIVATE_KEY or POLY_WALLET_ADDRESS' });

  const results = [];
  const wallet = new ethers.Wallet(privateKey);
  const checksumAddr = ethers.getAddress(walletAddr);
  const ts = Math.floor(Date.now() / 1000);
  const nonce = 0;

  results.push({ step: 'init', walletFromPK: wallet.address, walletEnvVar: checksumAddr, match: wallet.address.toLowerCase() === checksumAddr.toLowerCase() });

  // ── L1 sign ───────────────────────────────────────────────────────────────
  const l1Value = { address: checksumAddr, timestamp: `${ts}`, nonce, message: MSG_TO_SIGN };
  const l1Sig = await wallet.signTypedData(L1_DOMAIN, L1_TYPES, l1Value);
  results.push({ step: 'L1 EIP-712 signed (chainId=137)', sig: l1Sig.slice(0, 40) + '...' });

  const l1Headers = {
    'content-type': 'application/json',
    'poly_address':   checksumAddr,
    'poly_signature': l1Sig,
    'poly_timestamp': `${ts}`,
    'poly_nonce':     `${nonce}`,
  };

  // ── GET /auth/derive-api-key (correct derive endpoint per official docs) ──
  try {
    const r = await fetch('https://clob.polymarket.com/auth/derive-api-key', {
      method: 'GET', headers: l1Headers, signal: AbortSignal.timeout(8000),
    });
    const body = await r.text();
    results.push({ step: 'GET /auth/derive-api-key', status: r.status, body: body.slice(0, 500) });
    if (r.ok) {
      const data = JSON.parse(body);
      results.push({ step: '✅ DERIVED CREDS', apiKey: data.apiKey || data.api_key, passphrase: data.passphrase ? '(set)' : '(missing)', secret: data.secret ? '(set)' : '(missing)' });
    }
  } catch (e) {
    results.push({ step: 'GET /auth/derive-api-key ERROR', error: e.message });
  }

  // ── GET /auth/api-key (alternate — some docs say this works too) ──────────
  try {
    const r = await fetch('https://clob.polymarket.com/auth/api-key', {
      method: 'GET', headers: l1Headers, signal: AbortSignal.timeout(8000),
    });
    const body = await r.text();
    results.push({ step: 'GET /auth/api-key (alt)', status: r.status, body: body.slice(0, 200) });
  } catch (e) {
    results.push({ step: 'GET /auth/api-key alt ERROR', error: e.message });
  }

  // ── L2: Test DERIVED creds (freshly derived above) ───────────────────────
  let derivedKey = null, derivedSecret = null, derivedPassphrase = null;
  try {
    const r2 = await fetch('https://clob.polymarket.com/auth/derive-api-key', {
      method: 'GET', headers: l1Headers, signal: AbortSignal.timeout(8000),
    });
    if (r2.ok) {
      const d = await r2.json();
      derivedKey = d.apiKey;
      derivedSecret = d.secret;
      derivedPassphrase = d.passphrase;
    }
  } catch (_) {}

  if (derivedKey && derivedSecret && derivedPassphrase) {
    // GET /trades with derived creds
    const ts2 = Math.floor(Date.now() / 1000);
    const sig2 = await hmacSign(derivedSecret, ts2, 'GET', '/trades');
    try {
      const r = await fetch(`https://clob.polymarket.com/trades?maker_address=${checksumAddr}&limit=5`, {
        headers: {
          'poly_address':    checksumAddr,
          'poly_signature':  sig2,
          'poly_timestamp':  `${ts2}`,
          'poly_api_key':    derivedKey,
          'poly_passphrase': derivedPassphrase,
        },
        signal: AbortSignal.timeout(8000),
      });
      const body = await r.text();
      results.push({ step: 'GET /trades (L2 derived creds)', status: r.status, body: body.slice(0, 400) });
    } catch (e) {
      results.push({ step: 'GET /trades ERROR', error: e.message });
    }

    // Compare derived vs stored
    results.push({
      step: 'creds comparison',
      derivedKey,
      storedKey: storedApiKey,
      match: derivedKey === storedApiKey,
      note: derivedKey !== storedApiKey ? '⚠️ MISMATCH — update secrets!' : '✅ matches stored',
    });
  } else {
    results.push({ step: 'L2 test skipped', reason: 'derive failed' });
  }

  return Response.json({ results, wallet: checksumAddr, ts });
});