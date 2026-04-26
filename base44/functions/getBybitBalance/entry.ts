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
    const orderServerPort = Deno.env.get('ORDER_SERVER_PORT') || '3000';

    if (!dropletIp || !dropletSecret) {
      return Response.json({ error: 'Droplet credentials not configured' }, { status: 500 });
    }

    // Call droplet's order server to fetch balance (droplet can access Bybit from its IP)
    const response = await fetch(`http://${dropletIp}:${orderServerPort}/api/balance`, {
      method: 'GET',
      headers: {
        'X-Droplet-Secret': dropletSecret,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return Response.json({ 
        error: 'Failed to fetch balance from droplet', 
        details: error
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