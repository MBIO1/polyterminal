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

    // Try both known balance paths — deployed version may differ from repo
    const paths = ['/api/balance', '/balance'];
    let data = null;
    let lastError = null;

    for (const path of paths) {
      try {
        const response = await fetch(`http://${dropletIp}:${orderServerPort}${path}`, {
          method: 'GET',
          headers: {
            'X-Droplet-Secret': dropletSecret,
            'Authorization': `Bearer ${dropletSecret}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        });

        if (response.ok) {
          data = await response.json();
          break;
        }
        lastError = { path, status: response.status, body: await response.text() };
      } catch (e) {
        lastError = { path, error: e.message };
      }
    }

    if (!data) {
      return Response.json({ 
        error: 'Failed to fetch balance from droplet', 
        details: lastError,
        dropletIp,
        port: orderServerPort,
      }, { status: 503 });
    }
    
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