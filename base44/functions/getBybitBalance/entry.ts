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
      return Response.json({ error: 'Droplet credentials not configured' }, { status: 500 });
    }

    // First check if droplet is responding at all
    let healthCheck;
    try {
      healthCheck = await fetch(`http://${dropletIp}:${orderServerPort}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      return Response.json({ 
        error: 'Droplet unreachable',
        details: 'Health endpoint timeout',
        dropletIp,
        port: orderServerPort
      }, { status: 503 });
    }

    // Now fetch balance
    const response = await fetch(`http://${dropletIp}:${orderServerPort}/balance`, {
      method: 'GET',
      headers: {
        'X-Droplet-Secret': dropletSecret,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return Response.json({ 
        error: 'Failed to fetch balance from droplet', 
        details: errorText,
        dropletIp,
        port: orderServerPort,
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
      error: 'Droplet unreachable',
      details: error.message || 'Connection timeout'
    }, { status: 503 });
  }
});