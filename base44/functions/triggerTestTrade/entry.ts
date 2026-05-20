// triggerTestTrade — creates a $1 paper test trade, sends it to the order-server,
// and records the result in ArbTrade so it shows up in the Trades page.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const dropletIp     = Deno.env.get('DROPLET_IP');
    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const port          = Deno.env.get('ORDER_SERVER_PORT') || '4001';

    // Generate a trade ID
    const tradeId = `TEST-${Date.now()}`;
    const now     = new Date().toISOString();

    // Create the ArbTrade record immediately (Planned)
    const tradeRecord = await base44.asServiceRole.entities.ArbTrade.create({
      trade_id:         tradeId,
      status:           'Planned',
      strategy:         'Cross-venue Spot Spread',
      asset:            'BTC',
      spot_exchange:    'Bybit',
      perp_exchange:    'Bybit',
      direction:        'Long Spot / Short Perp',
      allocated_capital: 1,
      spot_qty:         0,
      perp_qty:         0,
      mode:             'paper',
      trade_date:       now.slice(0, 10),
      entry_timestamp:  now,
      entry_thesis:     `[$1 test trade] Triggered manually by ${user.email} at ${now}`,
    });

    const result = { tradeId, recordId: tradeRecord.id, dropletResult: null, error: null };

    // Check ArbConfig for paper_trading flag
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-updated_date', 1);
    const config = configs?.[0];
    const isPaper = config?.paper_trading !== false; // default: paper

    // Try to send to order-server if live mode + droplet configured
    if (dropletIp && dropletSecret && !isPaper) {
      try {
        // Get current BTC price to compute ~$1 worth of qty
        // Fetch instrument info to get minQty
        let btcPrice = 100000; // conservative fallback
        try {
          const priceRes = await fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT');
          const priceData = await priceRes.json();
          btcPrice = parseFloat(priceData?.result?.list?.[0]?.lastPrice || btcPrice);
        } catch {}

        // Bybit minimum for BTCUSDT: spot=0.000048, perp=0.001 — use the binding constraint
        const rawQty = 0.001; // ~$100 at $100k BTC — minimum perp lot size

        const payload = {
          trade_id:     tradeId,
          pair:         'BTC-USDT',
          asset:        'BTC',
          qty:          rawQty,
          buy_exchange:  'bybit-spot',
          sell_exchange: 'bybit-perp',
          buy_price:    btcPrice,
          sell_price:   btcPrice,
          net_edge_bps: 5,
          mode:         'paper',
          test:         true,
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(`http://${dropletIp}:${port}/execute`, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${dropletSecret}`,
          },
          body:    JSON.stringify(payload),
          signal:  controller.signal,
        });
        clearTimeout(timeout);

        const data = await res.json().catch(() => ({ status: res.status }));
        result.dropletResult = { status: res.status, ...data };

        // Update trade with droplet result
        const tradeStatus = res.ok ? 'Closed' : 'Error';
        const notes = res.ok
          ? `[TEST] Order-server responded OK: ${JSON.stringify(data)}`
          : `[TEST] Order-server error ${res.status}: ${JSON.stringify(data)}`;

        await base44.asServiceRole.entities.ArbTrade.update(tradeRecord.id, {
          status:           tradeStatus,
          exit_timestamp:   new Date().toISOString(),
          net_pnl:          0,
          review_notes:     notes,
          mode:             'paper',
        });
        result.finalStatus = tradeStatus;

      } catch (fetchErr) {
        result.error = `Droplet unreachable: ${fetchErr.message}`;
        // Still mark trade as Closed (paper simulation)
        await base44.asServiceRole.entities.ArbTrade.update(tradeRecord.id, {
          status:       'Closed',
          exit_timestamp: new Date().toISOString(),
          net_pnl:      0,
          mode:         'paper',
          review_notes: `[TEST] Droplet not reachable (${fetchErr.message}) — paper trade recorded only`,
        });
        result.finalStatus = 'Closed (paper only)';
      }
    } else {
      // Paper mode or no droplet — simulate only
      const note = isPaper
        ? '[TEST] Paper mode active — no real order sent. Toggle paper_trading=false in Config to test live execution.'
        : '[TEST] Paper simulation — no DROPLET_IP configured';
      await base44.asServiceRole.entities.ArbTrade.update(tradeRecord.id, {
        status:         'Closed',
        exit_timestamp: new Date().toISOString(),
        net_pnl:        0,
        mode:           'paper',
        review_notes:   note,
      });
      result.finalStatus = 'Closed (paper simulation)';
      result.paperNote = note;
    }

    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('[triggerTestTrade] error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});