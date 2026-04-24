// Live OKX Execution Tester
// 
// Tests execution with OKX API keys before live trading
// Validates latency, fees, and execution quality

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// OKX API Configuration
const OKX_BASE_URL = 'https://www.okx.com';
const OKX_PAPER_URL = 'https://www.okx.com'; // Paper trading uses same endpoint with demo keys
const DROPLET_IP = Deno.env.get('DROPLET_IP') || '162.243.186.5';
const DROPLET_PORT = 3000;
const DROPLET_PROXY_URL = `http://${DROPLET_IP}:${DROPLET_PORT}`;

interface OKXCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  isDemo?: boolean;
}

interface ExecutionTestResult {
  success: boolean;
  latency: number;
  orderId?: string;
  filledPrice?: number;
  filledSize?: number;
  fee?: number;
  error?: string;
}

/**
 * Generate OKX signature
 */
async function generateOKXSignature(
  timestamp: string,
  method: string,
  path: string,
  body: string,
  secret: string
): Promise<string> {
  const message = timestamp + method.toUpperCase() + path + body;
  
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
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Make authenticated OKX API request
 */
async function okxRequest(
  credentials: OKXCredentials,
  method: string,
  path: string,
  body: any = null
): Promise<{ response: Response; latency: number }> {
  const timestamp = new Date().toISOString();
  const bodyString = body ? JSON.stringify(body) : '';
  
  const signature = await generateOKXSignature(
    timestamp,
    method,
    path,
    bodyString,
    credentials.apiSecret
  );
  
  const startTime = Date.now();
  
  const response = await fetch(`${DROPLET_PROXY_URL}/proxy/okx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Droplet-Secret': Deno.env.get('DROPLET_SECRET') || '',
    },
    body: JSON.stringify({
      method,
      path,
      headers: {
        'OK-ACCESS-KEY': credentials.apiKey,
        'OK-ACCESS-SIGN': signature,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': credentials.passphrase,
        'Content-Type': 'application/json',
      },
      body: bodyString || undefined,
    }),
  });
  
  const latency = Date.now() - startTime;
  
  return { response, latency };
}

/**
 * Get account balance
 */
export async function getOKXBalance(credentials: OKXCredentials): Promise<any> {
  const { response, latency } = await okxRequest(
    credentials,
    'GET',
    '/api/v5/account/balance'
  );
  
  const responseText = await response.text();
  console.log('[OKX Test] Balance response:', response.status, responseText.slice(0, 200));
  
  if (!response.ok) {
    throw new Error(`OKX API error ${response.status}: ${responseText}`);
  }
  
  const data = JSON.parse(responseText);
  return { data, latency };
}

/**
 * Get current ticker price (public endpoint, no auth needed)
 */
export async function getOKXTicker(credentials: OKXCredentials, instId: string): Promise<any> {
  const startTime = Date.now();
  
  const response = await fetch(`${DROPLET_PROXY_URL}/proxy/okx-public`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Droplet-Secret': Deno.env.get('DROPLET_SECRET') || '',
    },
    body: JSON.stringify({
      instId,
    }),
  });
  
  const latency = Date.now() - startTime;
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OKX API error: ${error}`);
  }
  
  const data = await response.json();
  return { data, latency };
}

/**
 * Test order execution (limit order, then cancel)
 */
export async function testOKXExecution(
  credentials: OKXCredentials,
  instId: string = 'BTC-USDT',
  size: string = '0.01'
): Promise<ExecutionTestResult> {
  const startTime = Date.now();
  
  try {
    // Step 1: Get current price
    const ticker = await getOKXTicker(credentials, instId);
    const currentPrice = parseFloat(ticker.data.data[0].last);
    
    // Place limit order 5% below market (won't fill, for testing only)
    const testPrice = (currentPrice * 0.95).toFixed(2);
    
    const orderBody = {
      instId,
      tdMode: 'cash',
      side: 'buy',
      ordType: 'limit',
      sz: size,
      px: testPrice,
    };
    
    const { response: orderResponse, latency: orderLatency } = await okxRequest(
      credentials,
      'POST',
      '/api/v5/trade/order',
      orderBody
    );
    
    const orderData = await orderResponse.json();
    
    if (!orderResponse.ok || orderData.code !== '0') {
      return {
        success: false,
        latency: Date.now() - startTime,
        error: orderData.msg || 'Order failed',
      };
    }
    
    const orderId = orderData.data[0].ordId;
    
    // Immediately cancel the test order
    const cancelBody = {
      instId,
      ordId: orderId,
    };
    
    await okxRequest(credentials, 'POST', '/api/v5/trade/cancel-order', cancelBody);
    
    return {
      success: true,
      latency: orderLatency,
      orderId,
    };
    
  } catch (error) {
    return {
      success: false,
      latency: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * Get fee rates
 */
export async function getOKXFeeRates(credentials: OKXCredentials): Promise<any> {
  const { response, latency } = await okxRequest(
    credentials,
    'GET',
    '/api/v5/account/trade-fee'
  );
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OKX API error: ${error}`);
  }
  
  const data = await response.json();
  return { data, latency };
}

/**
 * Full OKX connection test
 */
export async function testOKXConnection(credentials: OKXCredentials): Promise<any> {
  const results = {
    timestamp: new Date().toISOString(),
    tests: {} as any,
    overall: 'pending',
  };
  
  try {
    // Test 1: Balance
    const balance = await getOKXBalance(credentials);
    results.tests.balance = {
      success: true,
      latency: balance.latency,
      hasFunds: balance.data.data?.length > 0,
    };
    
    // Test 2: Ticker
    const ticker = await getOKXTicker(credentials, 'BTC-USDT');
    results.tests.ticker = {
      success: true,
      latency: ticker.latency,
      price: ticker.data.data?.[0]?.last,
    };
    
    // Test 3: Fee rates
    const fees = await getOKXFeeRates(credentials);
    results.tests.fees = {
      success: true,
      latency: fees.latency,
      maker: fees.data.data?.[0]?.maker,
      taker: fees.data.data?.[0]?.taker,
    };
    
    // Test 4: Order execution (paper)
    const execution = await testOKXExecution(credentials, 'BTC-USDT', '0.001');
    results.tests.execution = execution;
    
    results.overall = execution.success ? 'passed' : 'failed';
    
  } catch (error) {
    results.overall = 'error';
    results.error = error.message;
  }
  
  return results;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Auth check
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await req.json().catch(() => ({}));
    
    // Get credentials from request or environment
    const credentials: OKXCredentials = {
      apiKey: body.apiKey || Deno.env.get('OKX_API_KEY') || '',
      apiSecret: body.apiSecret || Deno.env.get('OKX_API_SECRET') || '',
      passphrase: body.passphrase || Deno.env.get('OKX_PASSPHRASE') || '',
      isDemo: body.isDemo ?? true,
    };
    
    if (!credentials.apiKey || !credentials.apiSecret) {
      return Response.json({ 
        error: 'OKX credentials required. Provide apiKey, apiSecret, passphrase in body or set environment variables.' 
      }, { status: 400 });
    }
    
    // Run tests
    const results = await testOKXConnection(credentials);
    
    // Log test
    console.log('[OKX Test] Results:', { userId: user.id, overall: results.overall });
    
    return Response.json({
      ok: true,
      ...results,
    });
    
  } catch (error) {
    console.error('okxLiveTest error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});