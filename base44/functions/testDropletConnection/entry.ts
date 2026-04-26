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
      return Response.json({ error: 'Missing DROPLET_IP or DROPLET_SECRET' }, { status: 500 });
    }

    // Test health endpoint
    const response = await fetch(`http://${dropletIp}:${orderServerPort}/health`, {
      method: 'GET',
      headers: { 'X-Droplet-Secret': dropletSecret },
    });

    if (!response.ok) {
      return Response.json({ 
        status: 'unreachable',
        dropletIp,
        statusCode: response.status,
      }, { status: 500 });
    }

    const data = await response.json();
    
    return Response.json({
      status: 'connected',
      dropletIp,
      orderServer: data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return Response.json({ 
      status: 'error',
      error: error.message,
      dropletIp: Deno.env.get('DROPLET_IP')
    }, { status: 500 });
  }
});