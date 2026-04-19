/**
 * testClobAuth — reads current env vars directly and runs full Polymarket auth flow.
 * This is the SINGLE source of truth for diagnosing auth.
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

// Polymarket HMAC: base64url-decode the secret to bytes, sign, then base64url-encode the result
function base64UrlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_');
}
async function hmacSign(secret, ts, method, path, body = '') {
  const msg = `${ts}${method.toUpperCase()}${path}${body}`;
  const keyBytes = base64UrlDecode(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return base64UrlEncode(buf);
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  // Read env vars fresh every time — no caching
  const privateKey       = Deno.env.get('POLY_PRIVATE_KEY');
  const walletAddrEnv    = Deno.env.get('POLY_WALLET_ADDRESS');
  const storedApiKey     = Deno.env.get('POLY_API_KEY');
  const storedApiSecret  = Deno.env.get('POLY_API_SECRET');
  const storedPassphrase = Deno.env.get('POLY_API_PASSPHRASE');

  const envStatus = {
    POLY_PRIVATE_KEY:    privateKey ? `SET (len=${privateKey.length}, ends=...${privateKey.slice(-6)})` : 'MISSING',
    POLY_WALLET_ADDRESS: walletAddrEnv || 'MISSING',
    POLY_API_KEY:        storedApiKey || 'MISSING',
    POLY_API_SECRET:     storedApiSecret ? `SET (len=${storedApiSecret.length})` : 'MISSING',
    POLY_API_PASSPHRASE: storedPassphrase ? `SET (len=${storedPassphrase.length})` : 'MISSING',
  };

  if (!privateKey || !walletAddrEnv) {
    return Response.json({ error: 'Missing POLY_PRIVATE_KEY or POLY_WALLET_ADDRESS', envStatus });
  }

  const results = [];
  const wallet = new ethers.Wallet(privateKey);
  const derivedWallet = wallet.address;
  const checksumAddr  = ethers.getAddress(walletAddrEnv);
  const ts = Math.floor(Date.now() / 1000);
  const nonce = 0;

  results.push({
    step: 'env + wallet check',
    envStatus,
    walletFromPrivateKey: derivedWallet,
    walletFromEnvVar:     checksumAddr,
    match: derivedWallet.toLowerCase() === checksumAddr.toLowerCase(),
  });

  if (derivedWallet.toLowerCase() !== checksumAddr.toLowerCase()) {
    return Response.json({ results, error: 'Private key does not match wallet address' });
  }

  // ── L1 sign ─────────────────────────────────────────────────────────────────
  const l1Value = { address: checksumAddr, timestamp: `${ts}`, nonce, message: MSG_TO_SIGN };
  const l1Sig = await wallet.signTypedData(L1_DOMAIN, L1_TYPES, l1Value);

  const l1Headers = {
    'content-type':   'application/json',
    'poly_address':   checksumAddr,
    'poly_signature': l1Sig,
    'poly_timestamp': `${ts}`,
    'poly_nonce':     `${nonce}`,
  };

  // ── Derive fresh API key ────────────────────────────────────────────────────
  let derivedKey = null, derivedSecret = null, derivedPassphrase = null;
  try {
    const r = await fetch('https://clob.polymarket.com/auth/derive-api-key', {
      method: 'GET', headers: l1Headers, signal: AbortSignal.timeout(8000),
    });
    const body = await r.text();
    results.push({ step: 'GET /auth/derive-api-key', status: r.status, body: body.slice(0, 500) });
    if (r.ok) {
      const data = JSON.parse(body);
      derivedKey        = data.apiKey;
      derivedSecret     = data.secret;
      derivedPassphrase = data.passphrase;
      results.push({ step: '✅ FRESH DERIVED CREDS', apiKey: derivedKey, secretLen: derivedSecret?.length, passphraseLen: derivedPassphrase?.length });
    }
  } catch (e) {
    results.push({ step: 'derive ERROR', error: e.message });
  }

  // ── Compare stored vs derived ───────────────────────────────────────────────
  if (derivedKey) {
    results.push({
      step: 'stored vs derived',
      storedKey:       storedApiKey,
      derivedKey,
      keyMatch:        storedApiKey === derivedKey,
      needsUpdate:     storedApiKey !== derivedKey,
    });
  }

  // ── Test stored creds against /trades ───────────────────────────────────────
  if (storedApiKey && storedApiSecret && storedPassphrase) {
    const ts2 = Math.floor(Date.now() / 1000);
    const sig2 = await hmacSign(storedApiSecret, ts2, 'GET', '/trades');
    try {
      const r = await fetch(`https://clob.polymarket.com/trades?maker_address=${checksumAddr}&limit=5`, {
        headers: {
          'poly_address':    checksumAddr,
          'poly_signature':  sig2,
          'poly_timestamp':  `${ts2}`,
          'poly_api_key':    storedApiKey,
          'poly_passphrase': storedPassphrase,
        },
        signal: AbortSignal.timeout(8000),
      });
      const body = await r.text();
      results.push({ step: 'GET /trades with STORED creds', status: r.status, body: body.slice(0, 300) });
    } catch (e) {
      results.push({ step: 'GET /trades STORED error', error: e.message });
    }
  }

  // ── Test derived creds against multiple endpoints ───────────────────────────
  if (derivedKey && derivedSecret && derivedPassphrase) {
    const endpoints = [
      { method: 'GET', path: '/trades',         url: `https://clob.polymarket.com/trades?maker_address=${checksumAddr}&limit=5` },
      { method: 'GET', path: '/data/api-keys',  url: 'https://clob.polymarket.com/data/api-keys' },
      { method: 'GET', path: '/auth/api-keys',  url: 'https://clob.polymarket.com/auth/api-keys' },
      { method: 'GET', path: '/data/positions', url: `https://clob.polymarket.com/data/positions?user=${checksumAddr}` },
    ];
    for (const ep of endpoints) {
      const ts3 = Math.floor(Date.now() / 1000);
      const sig3 = await hmacSign(derivedSecret, ts3, ep.method, ep.path);
      try {
        const r = await fetch(ep.url, {
          method: ep.method,
          headers: {
            'poly_address':    checksumAddr,
            'poly_signature':  sig3,
            'poly_timestamp':  `${ts3}`,
            'poly_api_key':    derivedKey,
            'poly_passphrase': derivedPassphrase,
          },
          signal: AbortSignal.timeout(8000),
        });
        const body = await r.text();
        results.push({ step: `${ep.method} ${ep.path} DERIVED`, status: r.status, body: body.slice(0, 250) });
      } catch (e) {
        results.push({ step: `${ep.method} ${ep.path} ERROR`, error: e.message });
      }
    }
  }

  return Response.json({ wallet: checksumAddr, ts, results });
});