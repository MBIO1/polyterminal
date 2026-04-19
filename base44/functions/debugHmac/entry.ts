/**
 * debugHmac — step-by-step HMAC signing debug
 * Tests multiple signing variations to find what Polymarket actually accepts
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

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const privateKey = Deno.env.get('POLY_PRIVATE_KEY');
  const walletAddr = Deno.env.get('POLY_WALLET_ADDRESS');

  const wallet = new ethers.Wallet(privateKey);
  const checksumAddr = ethers.getAddress(walletAddr);
  const ts = Math.floor(Date.now() / 1000);
  const nonce = 0;

  // L1 sign
  const l1Value = { address: checksumAddr, timestamp: `${ts}`, nonce, message: MSG_TO_SIGN };
  const l1Sig = await wallet.signTypedData(L1_DOMAIN, L1_TYPES, l1Value);

  const l1Headers = {
    'content-type': 'application/json',
    'poly_address':   checksumAddr,
    'poly_signature': l1Sig,
    'poly_timestamp': `${ts}`,
    'poly_nonce':     `${nonce}`,
  };

  // Derive fresh creds
  const deriveRes = await fetch('https://clob.polymarket.com/auth/derive-api-key', {
    method: 'GET', headers: l1Headers, signal: AbortSignal.timeout(8000),
  });
  const creds = await deriveRes.json();
  const { apiKey, secret, passphrase } = creds;

  const results = [{ step: 'derived', apiKey, secret: secret?.slice(0,10)+'...', passphrase: passphrase?.slice(0,10)+'...' }];

  // Now test many signing variations for GET /trades
  const ts2 = Math.floor(Date.now() / 1000);
  const ts2s = `${ts2}`;
  const path = '/trades';
  const queryStr = `?maker_address=${checksumAddr}&limit=5`;
  const fullUrl = `https://clob.polymarket.com${path}${queryStr}`;

  const variations = [
    { label: 'ts+GET+path (no body)',         msg: `${ts2s}GET${path}` },
    { label: 'ts+GET+path+query',             msg: `${ts2s}GET${path}${queryStr}` },
    { label: 'ts+GET+fullurl',                msg: `${ts2s}GET${fullUrl}` },
    { label: 'ts2+method+path (int ts)',      msg: `${ts2}GET${path}` },
    { label: 'ts+get+path (lowercase)',       msg: `${ts2s}get${path}` },
    { label: 'ts+GET+/trades (no body, int ts2 as str)', msg: ts2s + 'GET' + path },
  ];

  for (const v of variations) {
    const sig = await hmacSign(secret, v.msg);
    try {
      const r = await fetch(fullUrl, {
        headers: {
          'POLY-ADDRESS':    checksumAddr,
          'POLY-SIGNATURE':  sig,
          'POLY-TIMESTAMP':  ts2s,
          'POLY-API-KEY':    apiKey,
          'POLY-PASSPHRASE': passphrase,
        },
        signal: AbortSignal.timeout(6000),
      });
      const body = await r.text();
      results.push({ label: v.label, status: r.status, msg_used: v.msg, sig: sig.slice(0,20)+'...', body: body.slice(0, 150) });
    } catch (e) {
      results.push({ label: v.label, error: e.message });
    }
  }

  // Also try with lowercase header names
  const sig3 = await hmacSign(secret, `${ts2s}GET${path}`);
  try {
    const r = await fetch(fullUrl, {
      headers: {
        'poly-address':    checksumAddr,
        'poly-signature':  sig3,
        'poly-timestamp':  ts2s,
        'poly-api-key':    apiKey,
        'poly-passphrase': passphrase,
      },
      signal: AbortSignal.timeout(6000),
    });
    const body = await r.text();
    results.push({ label: 'lowercase headers + path-only sig', status: r.status, body: body.slice(0, 150) });
  } catch (e) {
    results.push({ label: 'lowercase headers ERROR', error: e.message });
  }

  return Response.json({ results, ts: ts2, addr: checksumAddr });
});