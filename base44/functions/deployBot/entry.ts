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
    const baseUrl = Deno.env.get('BASE44_APP_URL');
    const userToken = Deno.env.get('BASE44_USER_TOKEN');

    if (!dropletIp || !dropletSecret) {
      return Response.json({ error: 'Missing DROPLET_IP or DROPLET_SECRET' }, { status: 500 });
    }

    // Fetch bot code from the downloadBot endpoint
    const botCodeRes = await fetch(`${baseUrl}/functions/downloadBot`, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });

    if (!botCodeRes.ok) {
      return Response.json({ 
        error: 'Failed to fetch bot code',
        statusCode: botCodeRes.status
      }, { status: 500 });
    }

    const botCode = await botCodeRes.text();

    // Send bot code to droplet for deployment
    const deployRes = await fetch(`http://${dropletIp}:${orderServerPort}/deploy-bot`, {
      method: 'POST',
      headers: {
        'X-Droplet-Secret': dropletSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        botCode,
        action: 'deploy-and-start'
      }),
    });

    if (!deployRes.ok) {
      const error = await deployRes.text();
      return Response.json({ 
        error: 'Failed to deploy bot',
        details: error,
        statusCode: deployRes.status
      }, { status: deployRes.status });
    }

    const result = await deployRes.json();
    
    return Response.json({
      status: 'bot_deployed',
      dropletIp,
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return Response.json({ 
      error: error.message || 'Deployment failed'
    }, { status: 500 });
  }
});