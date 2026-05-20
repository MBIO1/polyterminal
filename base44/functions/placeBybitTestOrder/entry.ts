// placeBybitTestOrder — places a single small market order on Bybit via the droplet's
// order-server. Used for end-to-end live execution verification ($1 test).
//
// Base44 → droplet (signs + executes on Bybit) → returns order ID → records ArbTrade row.
//
// Body (all optional):
//   { symbol: "BTCUSDT", side: "Buy" | "Sell", usd_amount: 1, category: "spot" | "linear" }
// Defaults: BTCUSDT, Buy, $1, spot.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return Response.json({ error: 'POST or GET only' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    let body = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { body = {}; }
    }

    const symbol      = String(body.symbol     || 'BTCUSDT');
    const side        = String(body.side       || 'Buy');
    const usdAmount   = Number(body.usd_amount || 1);
    const category    = String(body.category   || 'spot');     // 'spot' or 'linear'

    const dropletIp     = Deno.env.get('DROPLET_IP');
    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const port          = Deno.env.get('ORDER_SERVER_PORT') || '4001';

    if (!dropletIp || !dropletSecret) {
      return Response.json({ error: 'DROPLET_IP or DROPLET_SECRET not configured' }, { status: 500 });
    }

    // 1) Fetch current price (public Bybit API works from Base44 for ticker? No — geo-blocked.
    //    Use droplet's /price proxy if it exists, otherwise try CoinGecko as a price oracle).
    // CoinGecko mapping for popular symbols
    const cgMap = { BTCUSDT: 'bitcoin', ETHUSDT: 'ethereum', SOLUSDT: 'solana',
                    XRPUSDT: 'ripple', DOGEUSDT: 'dogecoin', ADAUSDT: 'cardano' };
    let price = 0;
    try {
      const cgId = cgMap[symbol];
      if (cgId) {
        const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`);
        const j = await r.json();
        price = Number(j?.[cgId]?.usd || 0);
      }
    } catch (e) {
      console.warn('[placeBybitTestOrder] price fetch failed:', e.message);
    }
    if (!price) {
      return Response.json({ error: `Could not fetch price for ${symbol}` }, { status: 500 });
    }

    // 2) Compute qty (in base asset). For spot Buy with marketUnit=quoteCoin, Bybit accepts USD amount directly.
    //    But our order-server uses baseCoin qty — so convert.
    const rawQty = usdAmount / price;

    // 3) Build a single-leg signal payload. The order-server's /execute expects a two-leg signal,
    //    but we'll send buy_exchange=sell_exchange=bybit-spot so spotSide=Buy, perpSide=Sell
    //    on the same symbol — that's NOT a single leg. So we need a new droplet endpoint OR
    //    we route via a dedicated path.
    //
    // Simpler: hit a new endpoint /single-order on the droplet. If it doesn't exist yet,
    // we'll return clear instructions to deploy the new order-server.
    const payload = { symbol, side, qty: String(rawQty.toFixed(8)), category, test: true };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let dropletRes, dropletJson;
    try {
      dropletRes = await fetch(`http://${dropletIp}:${port}/single-order`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${dropletSecret}`,
        },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      });
      clearTimeout(timeout);
      dropletJson = await dropletRes.json().catch(() => ({}));
    } catch (e) {
      clearTimeout(timeout);
      return Response.json({
        error: 'droplet_unreachable',
        details: e.message,
        hint: 'Make sure order-server is running on the droplet and supports POST /single-order. Run deployOrderServer to update it.',
      }, { status: 502 });
    }

    if (!dropletRes.ok) {
      return Response.json({
        error: 'droplet_rejected',
        status: dropletRes.status,
        details: dropletJson,
        hint: dropletRes.status === 404
          ? 'Order-server does not have /single-order endpoint yet — deploy the updated order-server.'
          : 'Check droplet logs: pm2 logs order-server',
      }, { status: 502 });
    }

    // 4) Record ArbTrade row for visibility
    const now = new Date().toISOString();
    const tradeId = `BYBIT-LIVE-${Date.now()}`;
    const tradeRecord = await base44.asServiceRole.entities.ArbTrade.create({
      trade_id:          tradeId,
      status:            dropletJson.ok ? 'Closed' : 'Error',
      strategy:          'Cross-venue Spot Spread',
      asset:             symbol.replace('USDT', '').slice(0, 6) || 'Other',
      spot_exchange:     'Bybit',
      perp_exchange:     '',
      direction:         `${side} ${symbol} (${category})`,
      allocated_capital: usdAmount,
      spot_qty:          parseFloat(rawQty.toFixed(8)),
      perp_qty:          0,
      spot_entry_px:     price,
      mode:              'live',
      trade_date:        now.slice(0, 10),
      entry_timestamp:   now,
      exit_timestamp:    now,
      entry_thesis:      `[$${usdAmount} LIVE TEST] ${side} ${symbol} on Bybit ${category}. Triggered by ${user.email}.`,
      review_notes:      `Bybit orderId: ${dropletJson.orderId || 'n/a'}. Response: ${JSON.stringify(dropletJson).slice(0, 400)}`,
    });

    return Response.json({
      ok: true,
      trade_id: tradeId,
      record_id: tradeRecord.id,
      symbol,
      side,
      category,
      usd_amount: usdAmount,
      price,
      qty: rawQty,
      bybit: dropletJson,
    });

  } catch (error) {
    console.error('[placeBybitTestOrder] error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});