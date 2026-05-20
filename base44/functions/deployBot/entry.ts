import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dropletIp     = Deno.env.get('DROPLET_IP');
    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const orderServerPort = Deno.env.get('ORDER_SERVER_PORT') || '4001';
    const baseUrl       = Deno.env.get('BASE44_APP_URL');
    const userToken     = Deno.env.get('BASE44_USER_TOKEN');
    const bybitApiKey   = Deno.env.get('BYBIT_API_KEY');
    const bybitApiSecret= Deno.env.get('BYBIT_API_SECRET');
    const bybitTestnet  = Deno.env.get('BYBIT_TESTNET') || 'false';

    if (!dropletIp || !dropletSecret) {
      return Response.json({ error: 'Missing DROPLET_IP or DROPLET_SECRET' }, { status: 500 });
    }

    // Fetch latest WS bot code
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

    // Full env for the bot
    const envVars = {
      DROPLET_SECRET:     dropletSecret,
      BYBIT_API_KEY:      bybitApiKey || '',
      BYBIT_API_SECRET:   bybitApiSecret || '',
      BYBIT_TESTNET:      bybitTestnet,
      ORDER_SERVER_PORT:  orderServerPort,
      BASE44_RESULT_URL:  `${baseUrl}/functions/ingestTradeResult`,
      BASE44_USER_TOKEN:  userToken,
      BASE44_INGEST_URL:  `${baseUrl}/functions/ingestSignal`,
      BASE44_HEARTBEAT_URL: `${baseUrl}/functions/ingestHeartbeat`,
      BASE44_STATS_URL:   `${baseUrl}/functions/signalStats`,
      BASE44_APP_URL:     baseUrl,
      MIN_NET_EDGE_BPS:   '2',
      ALERT_EDGE_BPS:     '20',
      MIN_FILLABLE_USD:   '50',
      DISABLE_BINANCE:    'true',
      PAIRS:              'BTC-USDT,ETH-USDT,SOL-USDT,BNB-USDT,AVAX-USDT',
    };

    // Send bot code + full env to droplet's /setup endpoint
    const deployRes = await fetch(`http://${dropletIp}:${orderServerPort}/setup`, {
      method: 'POST',
      headers: {
        'x-droplet-secret': dropletSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderServerCode: botCode,
        envVars,
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
      message: 'Bot code + env written to droplet via /setup. Restart the arb-bot service to apply.',
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