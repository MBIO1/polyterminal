/**
 * testClobAuth — full 2-step Polymarket CLOB auth test
 * Uses EXACT header names from Polymarket's open-source clob-client:
 * https://github.com/Polymarket/clob-client/blob/main/src/headers/index.ts
 *
 * L1 headers: POLY_ADDRESS, POLY_SIGNATURE, POLY_TIMESTAMP, POLY_NONCE
 * L2 headers: POLY_ADDRESS, POLY_SIGNATURE, POLY_TIMESTAMP, POLY_API_KEY, POLY_PASSPHRASE
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { ethers } from 'npm:ethers@6.13.0';

const MSG_TO_SIGN = "This message attests that I control the given wallet";

const L1_DOMAIN = { name: 'ClobAuthDomain', version: '1', chainId: 1 };
const L1_TYPES = {
  ClobAuth: [
    { name: 'address',   type: 'address' },
    { name: 'timestamp', type: 'string'  },
    { name: 'nonce',     type: 'uint256' },
    { name: 'message',   type: 'string'  },
  ],
};

async function hmacSign(secret, ts, method, path, body = '') {
  const msg = `${ts}${method.toUpperCase()}${path}${body}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const privateKey  = Deno.env.get('POLY_PRIVATE_KEY');
  const walletAddr  = Deno.env.get('POLY_WALLET_ADDRESS');
  const apiKey      = Deno.env.get('POLY_API_KEY');
  const apiSecret   = Deno.env.get('POLY_API_SECRET');
  const passphrase  = Deno.env.get('POLY_API_PASSPHRASE');

  if (!privateKey || !walletAddr) {
    return Response.json({ error: 'Missing POLY_PRIVATE_KEY or POLY_WALLET_ADDRESS' });
  }

  const results = [];
  const wallet = new ethers.Wallet(privateKey);
  const ts = Math.floor(Date.now() / 1000);
  const nonce = 0;

  // Try both chainId=1 and chainId=137
  const checksumAddr = ethers.getAddress(walletAddr); // ensure checksum format
  results.push({ step: 'wallet checksummed', address: checksumAddr });

  const signVariants = [
    { chainId: 1,   label: 'chainId=1 (mainnet)' },
    { chainId: 137, label: 'chainId=137 (polygon)' },
  ];

  let l1Sig = null;
  let workingChainId = null;

  for (const { chainId, label } of signVariants) {
    try {
      const domain = { name: 'ClobAuthDomain', version: '1', chainId };
      const value = { address: checksumAddr, timestamp: `${ts}`, nonce, message: MSG_TO_SIGN };
      const sig = await wallet.signTypedData(domain, L1_TYPES, value);
      results.push({ step: `L1 sign [${label}]`, sig: sig.slice(0, 40) + '...' });

      // Test this sig immediately
      const res = await fetch('https://clob.polymarket.com/auth/api-key', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'poly_address': checksumAddr,
          'poly_signature': sig,
          'poly_timestamp': `${ts}`,
          'poly_nonce': `${nonce}`,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.text();
      results.push({ step: `POST /auth/api-key [${label}]`, status: res.status, body: body.slice(0, 400) });
      if (res.ok) { l1Sig = sig; workingChainId = chainId; break; }
    } catch (e) {
      results.push({ step: `sign [${label}]`, error: e.message });
    }
  }

  if (!l1Sig) {
    return Response.json({ results, error: 'All L1 sign variants failed', note: 'Check private key matches wallet address' });
  }

  results.push({ step: `✅ Working chainId=${workingChainId}`, sig: l1Sig.slice(0,30)+'...' });

  // ── Step 3: Test stored L2 creds ─────────────────────────────────────────
  if (apiKey && apiSecret && passphrase) {
    const ts2 = Math.floor(Date.now() / 1000);

    // GET /trades — no body
    try {
      const sig = await hmacSign(apiSecret, ts2, 'GET', '/trades');
      const r = await fetch('https://clob.polymarket.com/trades?maker_address=' + walletAddr, {
        headers: {
          'POLY_ADDRESS':   walletAddr,
          'POLY_SIGNATURE': sig,
          'POLY_TIMESTAMP': `${ts2}`,
          'POLY_API_KEY':   apiKey,
          'POLY_PASSPHRASE': passphrase,
        },
        signal: AbortSignal.timeout(8000),
      });
      const body = await r.text();
      results.push({ step: 'GET /trades (stored L2)', status: r.status, body: body.slice(0, 300) });
    } catch (e) {
      results.push({ step: 'GET /trades', error: e.message });
    }
  }

  return Response.json({ results, wallet: walletAddr });
});