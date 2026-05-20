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

    if (!dropletIp || !dropletSecret) {
      return Response.json({ error: 'Droplet credentials not configured', dropletIp, hasSecret: !!dropletSecret }, { status: 500 });
    }

    // Call droplet's order server to fetch balance (droplet can access Bybit from its IP)
    let response;
    try {
      response = await fetch(`http://${dropletIp}:${orderServerPort}/api/balance`, {
        method: 'GET',
        headers: {
          'X-Droplet-Secret': dropletSecret,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch (fetchErr) {
      return Response.json({ 
        error: 'Droplet connection failed', 
        details: fetchErr.message,
        dropletIp,
        port: orderServerPort,
        hint: 'Check if droplet is running and ORDER_SERVER_PORT is correct'
      }, { status: 503 });
    }

    if (!response.ok) {
      const error = await response.text();
      return Response.json({ 
        error: 'Failed to fetch balance from droplet', 
        details: error,
        statusCode: response.status
      }, { status: response.status });
    }

    const data = await response.json();
    
    return Response.json({
      totalEquity: data.totalEquity || 0,
      totalAvailableBalance: data.totalAvailableBalance || 0,
      testnet: data.testnet || false,
      timestamp: new Date().toISOString(),
      coins: data.coins || []
    });
  } catch (error) {
    return Response.json({ 
      error: error.message || 'Internal server error'
    }, { status: 500 });
  }
});