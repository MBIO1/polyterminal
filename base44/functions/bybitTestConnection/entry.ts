import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Bybit V5 signed GET request
async function bybitGet(path, params = {}) {
  const isTestnet = (Deno.env.get('BYBIT_TESTNET') || 'true').toLowerCase() !== 'false';
  const base = isTestnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
  const apiKey = Deno.env.get('BYBIT_API_KEY');
  const apiSecret = Deno.env.get('BYBIT_API_SECRET');

  if (!apiKey || !apiSecret) {
    throw new Error('BYBIT_API_KEY or BYBIT_API_SECRET not set');
  }

  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const queryString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');

  // Bybit V5 signature: timestamp + apiKey + recvWindow + queryString
  const preSign = timestamp + apiKey + recvWindow + queryString;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(apiSecret);
  const msgData = encoder.encode(preSign);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const signature = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const url = queryString ? `${base}${path}?${queryString}` : `${base}${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
    },
  });
  const json = await res.json();
  return { httpStatus: res.status, body: json, environment: isTestnet ? 'testnet' : 'mainnet' };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    // 1) Server time (public, unsigned) — baseline connectivity
    const isTestnet = (Deno.env.get('BYBIT_TESTNET') || 'true').toLowerCase() !== 'false';
    const base = isTestnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
    const timeRes = await fetch(`${base}/v5/market/time`);
    const timeJson = await timeRes.json();

    // 2) Wallet balance (signed) — confirms API key + secret + permissions
    const wallet = await bybitGet('/v5/account/wallet-balance', { accountType: 'UNIFIED' });

    // 3) API key info (signed) — shows permissions on the key
    const keyInfo = await bybitGet('/v5/user/query-api', {});

    return Response.json({
      environment: isTestnet ? 'testnet' : 'mainnet',
      endpoint: base,
      serverTime: timeJson,
      walletBalance: {
        httpStatus: wallet.httpStatus,
        retCode: wallet.body?.retCode,
        retMsg: wallet.body?.retMsg,
        result: wallet.body?.result,
      },
      apiKeyInfo: {
        httpStatus: keyInfo.httpStatus,
        retCode: keyInfo.body?.retCode,
        retMsg: keyInfo.body?.retMsg,
        permissions: keyInfo.body?.result?.permissions,
        readOnly: keyInfo.body?.result?.readOnly,
        expiredAt: keyInfo.body?.result?.expiredAt,
      },
    });
  } catch (error) {
    console.error('bybitTestConnection error:', error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});