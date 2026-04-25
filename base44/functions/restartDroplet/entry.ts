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

    // Call droplet's restart endpoint
    const response = await fetch(`http://${dropletIp}:${orderServerPort}/restart`, {
      method: 'POST',
      headers: {
        'X-Droplet-Secret': dropletSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'restart' }),
    });

    if (!response.ok) {
      const error = await response.text();
      return Response.json({ 
        error: 'Failed to restart droplet',
        details: error,
        statusCode: response.status
      }, { status: response.status });
    }

    const data = await response.json();
    
    return Response.json({
      status: 'restart_initiated',
      dropletIp,
      timestamp: new Date().toISOString(),
      ...data
    });
  } catch (error) {
    return Response.json({ 
      error: error.message || 'Failed to restart droplet'
    }, { status: 500 });
  }
});