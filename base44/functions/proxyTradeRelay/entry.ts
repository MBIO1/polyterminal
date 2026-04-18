/**
 * Proxy Trade Relay
 * 
 * Accepts a signed order and broadcasts it through Oxylabs residential proxy
 * to bypass Polymarket geoblocking. Acts as a relay layer.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { orderPayload, signature, apiKey, apiSecret, passphrase, timestamp, hmacSig } = await req.json();

    const oxylabsUser = Deno.env.get('OXYLABS_USER');
    const oxylabsPass = Deno.env.get('OXYLABS_PASS');

    if (!oxylabsUser || !oxylabsPass) {
      throw new Error('Oxylabs credentials not configured');
    }

    // Build request through Oxylabs residential proxy
    const bodyStr = JSON.stringify(orderPayload);
    const headers = {
      'Content-Type': 'application/json',
      'POLY-SIGNATURE': hmacSig,
      'POLY-API-KEY': apiKey,
      'POLY-API-PASSPHRASE': passphrase,
      'POLY-NONCE': timestamp,
    };

    // Use Oxylabs residential proxy endpoint
    const proxyAuth = btoa(`${oxylabsUser}:${oxylabsPass}`);
    headers['Proxy-Authorization'] = `Basic ${proxyAuth}`;

    const res = await fetch('https://clob.polymarket.com/order', {
      method: 'POST',
      headers: headers,
      body: bodyStr,
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`Proxy relay failed: ${res.status} - ${errorText}`);
      throw new Error(`CLOB ${res.status}: ${errorText}`);
    }

    const result = await res.json();
    
    // Log successful relay
    await base44.asServiceRole.entities.BotTrade.create({
      market_title: `Proxied order ${orderPayload.tokenId.slice(0, 10)}…`,
      asset: 'BTC',
      contract_type: '5min_up',
      side: orderPayload.side === 0 ? 'yes' : 'no',
      entry_price: 0.5,
      size_usdc: 0,
      shares: 0,
      outcome: 'pending',
      mode: 'live',
      notes: `✅ Routed via Oxylabs proxy · ${user.email}`,
    });

    return Response.json({
      success: true,
      orderId: result.order_id || result.id,
      method: 'proxy_relay',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error.message,
      status: 'relay_error',
    }, { status: 500 });
  }
});