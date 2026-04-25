import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dropletIp = Deno.env.get('DROPLET_IP');
    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const orderServerPort = Deno.env.get('ORDER_SERVER_PORT') || '4001';
    const bybitApiKey = Deno.env.get('BYBIT_API_KEY');
    const bybitApiSecret = Deno.env.get('BYBIT_API_SECRET');
    const bybitTestnet = Deno.env.get('BYBIT_TESTNET') || 'false';
    const baseUrl = Deno.env.get('BASE44_APP_URL');
    const userToken = Deno.env.get('BASE44_USER_TOKEN');

    if (!dropletIp || !dropletSecret || !bybitApiKey || !bybitApiSecret) {
      return Response.json({ error: 'Missing required secrets' }, { status: 500 });
    }

    // Fetch order-server.mjs code from the app
    const orderServerUrl = `${baseUrl}/functions/downloadOrderServer`;
    const orderServerRes = await fetch(orderServerUrl, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });

    if (!orderServerRes.ok) {
      return Response.json({ 
        error: 'Failed to fetch order-server code',
        statusCode: orderServerRes.status
      }, { status: 500 });
    }

    const orderServerCode = await orderServerRes.text();

    // Send setup payload to droplet
    const setupRes = await fetch(`http://${dropletIp}:${orderServerPort}/setup`, {
      method: 'POST',
      headers: {
        'X-Droplet-Secret': dropletSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderServerCode,
        envVars: {
          DROPLET_SECRET: dropletSecret,
          BYBIT_API_KEY: bybitApiKey,
          BYBIT_API_SECRET: bybitApiSecret,
          BYBIT_TESTNET: bybitTestnet,
          ORDER_SERVER_PORT: orderServerPort,
          BASE44_RESULT_URL: `${baseUrl}/functions/ingestTradeResult`,
          BASE44_USER_TOKEN: userToken,
        },
      }),
    });

    if (!setupRes.ok) {
      const error = await setupRes.text();
      return Response.json({ 
        error: 'Setup failed on droplet',
        details: error,
        statusCode: setupRes.status
      }, { status: setupRes.status });
    }

    const result = await setupRes.json();
    
    return Response.json({
      status: 'setup_complete',
      dropletIp,
      message: 'Order server installed and running',
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return Response.json({ 
      error: error.message || 'Setup failed',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});