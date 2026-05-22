import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    console.log(`User auth: ${user?.email} role=${user?.role}`);

    if (!user || user.role !== 'admin') {
      console.log(`Auth failed: user=${!!user} role=${user?.role}`);
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dropletIp = Deno.env.get('DROPLET_IP');
    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const orderServerPort = Deno.env.get('ORDER_SERVER_PORT') || '4001';

    console.log(`Attempting to connect to droplet: ${dropletIp}:${orderServerPort}`);

    if (!dropletIp || !dropletSecret) {
      return Response.json({ error: 'Droplet credentials not configured' }, { status: 500 });
    }

    // Try both known balance paths — deployed version may differ from repo
    const paths = ['/balance', '/api/balance'];
    let data = null;
    let lastError = null;

    for (const path of paths) {
      try {
        const url = `http://${dropletIp}:${orderServerPort}${path}`;
        console.log(`Trying ${url}...`);
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-Droplet-Secret': dropletSecret,
            'Authorization': `Bearer ${dropletSecret}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        });

        const body = await response.text();
        console.log(`Path ${path} returned ${response.status}: ${body}`);

        if (response.ok) {
          try {
            data = JSON.parse(body);
            // Skip if this is the health check response
            if (data.status === 'online' && !data.totalEquity) {
              console.log('Got health check instead of balance, continuing...');
              lastError = { path, status: response.status, body, note: 'health check response' };
              continue;
            }
            console.log('Droplet balance raw:', JSON.stringify(data));
            break;
          } catch (parseErr) {
            console.log(`Failed to parse JSON: ${parseErr.message}`);
            lastError = { path, error: 'JSON parse failed', body };
          }
        } else {
          lastError = { path, status: response.status, body };
        }
      } catch (e) {
        console.log(`Path ${path} threw: ${e.message}`);
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
    
    // Handle both normalized format and raw Bybit API format
    const account = data.list ? data.list[0] : data;
    const coins = account.coin || data.coins || [];
    
    return Response.json({
      totalEquity: parseFloat(account.totalEquity || 0),
      totalAvailableBalance: parseFloat(account.totalAvailableBalance || 0),
      totalWalletBalance: parseFloat(account.totalWalletBalance || 0),
      testnet: data.testnet || process.env.BYBIT_TESTNET === 'true' || false,
      timestamp: new Date().toISOString(),
      coins: coins
        .map(c => ({
          coin: c.coin,
          equity: parseFloat(c.equity || 0),
          walletBalance: parseFloat(c.walletBalance || 0),
          availableBalance: parseFloat(c.availableToWithdraw || 0),
          usdValue: parseFloat(c.usdValue || 0),
        }))
        .filter(c => c.usdValue > 0.01)
    });
  } catch (error) {
    return Response.json({ 
      error: 'Droplet unreachable',
      details: error.message || 'Connection timeout'
    }, { status: 503 });
  }
});