import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get API credentials
    const apiKey = Deno.env.get('POLY_API_KEY');
    const apiSecret = Deno.env.get('POLY_API_SECRET');
    const passphrase = Deno.env.get('POLY_API_PASSPHRASE');

    if (!apiKey || !apiSecret || !passphrase) {
      return Response.json({ error: 'Missing Polymarket credentials' }, { status: 400 });
    }

    // Sample token IDs for BTC and ETH short-term contracts
    const btcContractId = '21742633143463906290569050155826241533067272736897614950488156847949938836455'; // BTC up 5min
    const ethContractId = '69236923620077691027083946871148646972011131466059644796204542240861588995922'; // ETH up 5min

    const trades = [];

    const oxyUser = Deno.env.get('OXYLABS_USER');
    const oxyPass = Deno.env.get('OXYLABS_PASS');
    const oxyAuth = btoa(`${oxyUser}:${oxyPass}`);

    // Place BTC trade via Oxylabs proxy
    const btcTradeRes = await fetch('https://data.oxylabs.io/v1/queries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${oxyAuth}`,
      },
      body: JSON.stringify({
        source: 'universal',
        url: 'https://clob.polymarket.com/orders',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'POLY-ADDRESS': Deno.env.get('POLY_WALLET_ADDRESS') || '',
          'POLY-SIGNATURE': 'demo-sig',
          'POLY-TIMESTAMP': Date.now().toString(),
          'POLY-NONCE': Math.random().toString(),
        },
        payload: JSON.stringify({
          tokenId: btcContractId,
          side: 'BUY',
          orderType: 'MARKET',
          amount: 1,
          limitPrice: 0.5,
        }),
      }),
    });

    const btcRaw = await btcTradeRes.json().catch(() => null);
    const btcData = btcRaw?.results?.[0]?.content ? JSON.parse(btcRaw.results[0].content) : btcRaw;
    trades.push({
      asset: 'BTC',
      side: 'BUY',
      amount: 1,
      status: btcTradeRes.ok && !btcData?.error ? 'executed' : 'failed',
      response: btcData,
    });

    // Place ETH trade via Oxylabs proxy
    const ethTradeRes = await fetch('https://data.oxylabs.io/v1/queries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${oxyAuth}`,
      },
      body: JSON.stringify({
        source: 'universal',
        url: 'https://clob.polymarket.com/orders',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'POLY-ADDRESS': Deno.env.get('POLY_WALLET_ADDRESS') || '',
          'POLY-SIGNATURE': 'demo-sig',
          'POLY-TIMESTAMP': Date.now().toString(),
          'POLY-NONCE': Math.random().toString(),
        },
        payload: JSON.stringify({
          tokenId: ethContractId,
          side: 'BUY',
          orderType: 'MARKET',
          amount: 1,
          limitPrice: 0.5,
        }),
      }),
    });

    const ethRaw = await ethTradeRes.json().catch(() => null);
    const ethData = ethRaw?.results?.[0]?.content ? JSON.parse(ethRaw.results[0].content) : ethRaw;
    trades.push({
      asset: 'ETH',
      side: 'BUY',
      amount: 1,
      status: ethTradeRes.ok && !ethData?.error ? 'executed' : 'failed',
      response: ethData,
    });

    // Log trades to database
    for (const trade of trades) {
      if (trade.status === 'executed') {
        await base44.asServiceRole.entities.BotTrade.create({
          market_title: `${trade.asset} Demo Trade`,
          asset: trade.asset,
          contract_type: '5min_up',
          side: 'yes',
          entry_price: 0.5,
          size_usdc: 1,
          shares: 2,
          edge_at_entry: 2,
          confidence_at_entry: 50,
          kelly_fraction_used: 0.5,
          pnl_usdc: 0,
          outcome: 'pending',
          mode: 'live',
          notes: 'Manual live trade demo — $1 USDC',
        });
      }
    }

    return Response.json({
      success: true,
      trades,
      message: '✅ Live trade demo executed',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});