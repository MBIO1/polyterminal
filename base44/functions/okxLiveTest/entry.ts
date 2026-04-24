// OKX Live Test - Tests API connection, latency, and execution quality
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// OKX API endpoints
const OKX_API_BASE = 'https://www.okx.com';
const OKX_DEMO_BASE = 'https://www.okx.com';

function getOKXTimestamp() {
  return new Date().toISOString();
}

async function signRequest(method, path, body, secret, key, passphrase) {
  const timestamp = getOKXTimestamp();
  const bodyStr = body ? JSON.stringify(body) : '';
  const messageStr = timestamp + method + path + bodyStr;
  
  const encoder = new TextEncoder();
  const keyData = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign('HMAC', keyData, encoder.encode(messageStr));
  const signatureBytes = new Uint8Array(signatureBuffer);
  const signatureBase64 = btoa(String.fromCharCode.apply(null, signatureBytes));
  
  return {
    timestamp,
    signature: signatureBase64,
    key,
    passphrase
  };
}

async function makeOKXRequest(method, path, body, credentials) {
  const url = `${OKX_API_BASE}${path}`;
  const sig = await signRequest(method, path, body, credentials.apiSecret, credentials.apiKey, credentials.passphrase);
  
  const res = await fetch(url, {
    method,
    headers: {
      'OK-ACCESS-KEY': sig.key,
      'OK-ACCESS-SIGN': sig.signature,
      'OK-ACCESS-TIMESTAMP': sig.timestamp,
      'OK-ACCESS-PASSPHRASE': sig.passphrase,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  return await res.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    
    const body = await req.json().catch(() => ({}));
    const { apiKey, apiSecret, passphrase, isDemo } = body;
    
    if (!apiKey || !apiSecret || !passphrase) {
      return Response.json({ error: 'Missing credentials' }, { status: 400 });
    }

    const tests = {};
    let overall = 'passed';

    // Test 1: Balance
    try {
      const start = Date.now();
      const balanceRes = await makeOKXRequest(
        'GET',
        '/api/v5/account/balance',
        null,
        { apiKey, apiSecret, passphrase }
      );
      const latency = Date.now() - start;
      
      if (balanceRes.code === '0' && balanceRes.data?.length > 0) {
        tests.balance = { success: true, latency };
      } else {
        tests.balance = { success: false, latency, error: balanceRes.msg || balanceRes.error || 'Failed' };
        overall = 'failed';
      }
    } catch (e) {
      tests.balance = { success: false, latency: 0, error: e.message };
      overall = 'failed';
    }

    // Test 2: Ticker (BTC-USDT)
    try {
      const start = Date.now();
      const tickerRes = await fetch(
        'https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT'
      );
      const latency = Date.now() - start;
      const data = await tickerRes.json();
      
      if (data.code === '0' && data.data?.length > 0) {
        const price = data.data[0].lastPx;
        tests.ticker = { success: true, latency, price };
      } else {
        tests.ticker = { success: false, latency, error: 'Failed' };
        overall = 'failed';
      }
    } catch (e) {
      tests.ticker = { success: false, latency: 0, error: e.message };
      overall = 'failed';
    }

    // Test 3: Fee Structure (Public endpoint)
    try {
      const feeRes = await fetch('https://www.okx.com/api/v5/account/trade-fee?instType=SPOT');
      const data = await feeRes.json();
      
      if (data.code === '0' && data.data?.length > 0) {
        const rule = data.data[0];
        tests.fees = {
          success: true,
          maker: parseFloat(rule.makerFeeRate || '0.0001'),
          taker: parseFloat(rule.takerFeeRate || '0.0002'),
        };
      } else {
        tests.fees = { success: false, maker: 0, taker: 0, error: 'Failed' };
        overall = 'failed';
      }
    } catch (e) {
      tests.fees = { success: false, maker: 0, taker: 0, error: e.message };
      overall = 'failed';
    }

    // Test 4: Execution (place and cancel test order)
    try {
      const start = Date.now();
      
      // Place a limit order below market (won't fill)
      const orderRes = await makeOKXRequest(
        'POST',
        '/api/v5/trade/order',
        {
          instId: 'BTC-USDT',
          tdMode: isDemo ? 'cash' : 'cash',
          side: 'buy',
          ordType: 'limit',
          px: '10000', // Way below market
          sz: '0.001',
        },
        { apiKey, apiSecret, passphrase }
      );
      
      const latency = Date.now() - start;
      
      if (orderRes.code === '0' && orderRes.data?.[0]?.ordId) {
        const ordId = orderRes.data[0].ordId;
        
        // Cancel the order
        await makeOKXRequest(
          'POST',
          '/api/v5/trade/cancel-order',
          { instId: 'BTC-USDT', ordId },
          { apiKey, apiSecret, passphrase }
        );
        
        tests.execution = { success: true, latency };
      } else {
        tests.execution = { success: false, latency, error: orderRes.msg || orderRes.error || 'Failed' };
        overall = 'failed';
      }
    } catch (e) {
      tests.execution = { success: false, latency: 0, error: e.message };
      overall = 'failed';
    }

    return Response.json({
      overall,
      tests,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('[okxLiveTest] error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});