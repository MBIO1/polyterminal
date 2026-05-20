import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function signHmacSha256(message, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const apiKey = Deno.env.get('BYBIT_API_KEY');
    const apiSecret = Deno.env.get('BYBIT_API_SECRET');
    const isTestnet = (Deno.env.get('BYBIT_TESTNET') || 'false').toLowerCase() !== 'false';

    if (!apiKey || !apiSecret) {
      return Response.json({ error: 'Bybit API credentials not configured' }, { status: 500 });
    }

    const bybitBase = isTestnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';

    // Fetch wallet balance directly from Bybit
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const preSign = timestamp + apiKey + recvWindow;
    const signature = await signHmacSha256(preSign, apiSecret);

    const response = await fetch(`${bybitBase}/v5/account/wallet-balance`, {
      method: 'GET',
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return Response.json({ 
        error: 'Bybit API request failed', 
        details: errorText,
        statusCode: response.status
      }, { status: response.status });
    }

    const json = await response.json();
    if (json.retCode !== 0) {
      return Response.json({ 
        error: 'Bybit API error', 
        details: json.retMsg,
        retCode: json.retCode
      }, { status: 500 });
    }

    const account = json.result?.list?.[0] || {};
    const coins = (account.coin || []).map(coin => ({
      coin: coin.coin,
      walletBalance: parseFloat(coin.walletBalance || 0),
      availableToWithdraw: parseFloat(coin.availableToWithdraw || 0),
      usdValue: parseFloat(coin.usdValue || 0),
    })).filter(c => c.usdValue > 0.001);

    return Response.json({
      totalEquity: parseFloat(account.totalEquity || 0),
      totalAvailableBalance: parseFloat(account.totalAvailableBalance || 0),
      testnet: isTestnet,
      timestamp: new Date().toISOString(),
      coins: coins
    });
  } catch (error) {
    return Response.json({ 
      error: error.message || 'Internal server error'
    }, { status: 500 });
  }
});