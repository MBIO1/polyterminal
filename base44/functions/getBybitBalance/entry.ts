import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const apiKey = Deno.env.get('BYBIT_API_KEY');
    const apiSecret = Deno.env.get('BYBIT_API_SECRET');
    const isTestnet = Deno.env.get('BYBIT_TESTNET') === 'true';

    if (!apiKey || !apiSecret) {
      return Response.json({ error: 'Bybit credentials not configured' }, { status: 500 });
    }

    const baseUrl = isTestnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
    const recvWindow = '5000';
    const timestamp = Date.now().toString();

    // Build signature for wallet balance request
    const params = { category: 'UNIFIED' };
    const queryString = new URLSearchParams(params).toString();
    const signatureText = timestamp + apiKey + recvWindow + 'GET' + '/v5/account/walletBalance?' + queryString;
    
    const encoder = new TextEncoder();
    const keyData = await crypto.subtle.importKey('raw', encoder.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureArrayBuffer = await crypto.subtle.sign('HMAC', keyData, encoder.encode(signatureText));
    const signature = Array.from(new Uint8Array(signatureArrayBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Fetch wallet balance from Bybit
    const response = await fetch(`${baseUrl}/v5/account/walletBalance?category=UNIFIED`, {
      method: 'GET',
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-SIGN-TYPE': '2',
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ retMsg: 'Unknown error' }));
      return Response.json({ 
        error: 'Failed to fetch balance from Bybit', 
        details: error.retMsg || error
      }, { status: response.status });
    }

    const bybitData = await response.json();
    
    if (bybitData.retCode !== 0) {
      return Response.json({ 
        error: 'Bybit API error', 
        details: bybitData.retMsg 
      }, { status: 400 });
    }

    // Parse balance data
    const coins = [];
    let totalEquity = 0;
    let totalAvailableBalance = 0;

    if (bybitData.result?.list?.[0]?.coin) {
      // Single coin response
      const coin = bybitData.result.list[0];
      coins.push({
        coin: coin.coin,
        walletBalance: parseFloat(coin.walletBalance || 0),
        availableBalance: parseFloat(coin.availableToWithdraw || 0),
        usdValue: parseFloat(coin.usdValue || 0),
      });
      totalEquity += parseFloat(coin.usdValue || 0);
      totalAvailableBalance += parseFloat(coin.availableToWithdraw || 0);
    } else if (bybitData.result?.list) {
      // Multi-coin response
      for (const coin of bybitData.result.list) {
        const usdValue = parseFloat(coin.usdValue || 0);
        if (usdValue > 0.001) {
          coins.push({
            coin: coin.coin,
            walletBalance: parseFloat(coin.walletBalance || 0),
            availableBalance: parseFloat(coin.availableToWithdraw || 0),
            usdValue,
          });
          totalEquity += usdValue;
          totalAvailableBalance += parseFloat(coin.availableToWithdraw || 0);
        }
      }
    }

    return Response.json({
      totalEquity,
      totalAvailableBalance,
      testnet: isTestnet,
      timestamp: new Date().toISOString(),
      coins
    });
  } catch (error) {
    return Response.json({ 
      error: error.message || 'Internal server error'
    }, { status: 500 });
  }
});