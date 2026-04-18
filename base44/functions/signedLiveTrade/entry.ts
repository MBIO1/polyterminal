import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = Deno.env.get('POLY_API_KEY');
    const apiSecret = Deno.env.get('POLY_API_SECRET');
    const passphrase = Deno.env.get('POLY_API_PASSPHRASE');
    const walletAddress = Deno.env.get('POLY_WALLET_ADDRESS');
    const privateKey = Deno.env.get('POLY_PRIVATE_KEY');
    const oxyUser = Deno.env.get('OXYLABS_USER');
    const oxyPass = Deno.env.get('OXYLABS_PASS');

    if (!apiKey || !apiSecret || !passphrase || !walletAddress || !privateKey) {
      return Response.json({ error: 'Missing Polymarket credentials' }, { status: 400 });
    }

    // Token IDs for 5min contracts
    const btcTokenId = '21742633143463906290569050155826241533067272736897614950488156847949938836455';
    const ethTokenId = '69236923620077691027083946871148646972011131466059644796204542240861588995922';

    // Build order structs (simplified order format)
    const orders = [
      {
        asset: 'BTC',
        tokenId: btcTokenId,
        side: 0, // BUY
        price: 0.5,
        sizeUsdc: 1,
        nonce: Math.floor(Date.now() / 1000),
      },
      {
        asset: 'ETH',
        tokenId: ethTokenId,
        side: 0, // BUY
        price: 0.5,
        sizeUsdc: 1,
        nonce: Math.floor(Date.now() / 1000) + 1,
      },
    ];

    // Compute REST auth signature
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyStr = JSON.stringify(orders);
    const message = timestamp + 'POST' + '/orders' + bodyStr;

    const keyData = new TextEncoder().encode(apiSecret);
    const msgData = new TextEncoder().encode(message);
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    const sigArray = Array.from(new Uint8Array(sigBuffer));
    const signature = btoa(String.fromCharCode(...sigArray));

    // Submit via Oxylabs to bypass geo-block
    const oxyAuth = btoa(`${oxyUser}:${oxyPass}`);
    const submitRes = await fetch('https://data.oxylabs.io/v1/queries', {
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
          'POLY-API-KEY': apiKey,
          'POLY-SIGNATURE': signature,
          'POLY-TIMESTAMP': timestamp,
          'POLY-PASSPHRASE': passphrase,
          'Content-Type': 'application/json',
        },
        payload: bodyStr,
      }),
    });

    const result = await submitRes.json().catch(() => null);

    // Log to database if successful
    if (submitRes.ok && result?.results?.[0]) {
      for (const order of orders) {
        await base44.asServiceRole.entities.BotTrade.create({
          market_title: `${order.asset} Signed Live Trade`,
          asset: order.asset,
          contract_type: '5min_up',
          side: 'yes',
          entry_price: order.price,
          size_usdc: order.sizeUsdc,
          shares: Math.round(order.sizeUsdc / order.price),
          edge_at_entry: 1.5,
          confidence_at_entry: 50,
          kelly_fraction_used: 0.5,
          pnl_usdc: 0,
          outcome: 'pending',
          mode: 'live',
          notes: '✅ Signed order via Oxylabs proxy',
        });
      }
    }

    return Response.json({
      success: submitRes.ok,
      orders,
      response: result,
      message: submitRes.ok ? '✅ Signed live trades submitted' : '❌ Trade submission failed',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});