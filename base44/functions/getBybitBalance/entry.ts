import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const bybitApiKey = Deno.env.get('BYBIT_API_KEY');
    const bybitApiSecret = Deno.env.get('BYBIT_API_SECRET');
    const isTestnet = Deno.env.get('BYBIT_TESTNET') === 'true';

    if (!bybitApiKey || !bybitApiSecret) {
      return Response.json({ error: 'Bybit credentials not configured' }, { status: 500 });
    }

    const endpoint = isTestnet 
      ? 'https://api-testnet.bybit.com'
      : 'https://api.bybit.com';

    const timestamp = Date.now().toString();
    const signature = await generateSignature(bybitApiSecret, timestamp, '');

    const response = await fetch(`${endpoint}/v5/account/wallet-balance`, {
      method: 'GET',
      headers: {
        'X-BAPI-API-KEY': bybitApiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-SIGN': signature,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return Response.json({ 
        error: 'Failed to fetch Bybit balance', 
        details: error,
        testnet: isTestnet 
      }, { status: response.status });
    }

    const data = await response.json();
    
    if (data.retCode !== 0) {
      return Response.json({ 
        error: data.retMsg || 'Bybit API error',
        testnet: isTestnet 
      }, { status: 400 });
    }

    // Extract total equity and available balance
    const accountList = data.result?.list || [];
    const mainAccount = accountList.find(a => a.accountType === 'UNIFIED') || accountList[0];
    
    const totalEquity = mainAccount?.totalEquity ? parseFloat(mainAccount.totalEquity) : 0;
    const totalAvailableBalance = mainAccount?.totalAvailableBalance ? parseFloat(mainAccount.totalAvailableBalance) : 0;

    return Response.json({
      totalEquity,
      totalAvailableBalance,
      testnet: isTestnet,
      timestamp: new Date().toISOString(),
      coins: mainAccount?.coin || []
    });
  } catch (error) {
    return Response.json({ 
      error: error.message || 'Internal server error',
      stack: error.stack 
    }, { status: 500 });
  }
});

async function generateSignature(secret, timestamp, body) {
  const message = timestamp + 'GET' + '/v5/account/wallet-balance' + body;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const hexArray = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0'));
  
  return hexArray.join('');
}