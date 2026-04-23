import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const count = Math.min(Number(body.count || 10), 50);

    const pairs = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'AVAX-USDT', 'LINK-USDT'];
    const venues = [
      { buy: 'OKX-spot', sell: 'OKX-perp' },
      { buy: 'Bybit-spot', sell: 'Bybit-perp' },
      { buy: 'OKX-perp', sell: 'OKX-spot' },
    ];

    const signals = [];
    const now = new Date().toISOString();

    for (let i = 0; i < count; i++) {
      const pair = pairs[i % pairs.length];
      const venue = venues[i % venues.length];
      const [asset] = pair.split('-');
      
      const basePrice = {
        'BTC': 77750,
        'ETH': 2330,
        'SOL': 86,
        'AVAX': 35,
        'LINK': 28,
      }[asset] || 100;

      const spread = 2 + Math.random() * 8; // 2-10 bps spread
      const netEdge = spread - 4; // 4 legs × 1 bps fee

      const buyPx = basePrice;
      const sellPx = basePrice * (1 + spread / 10000);

      signals.push({
        pair,
        asset,
        buy_exchange: venue.buy,
        sell_exchange: venue.sell,
        buy_price: buyPx,
        sell_price: sellPx,
        raw_spread_bps: spread,
        net_edge_bps: netEdge,
        buy_depth_usd: 50000 + Math.random() * 100000,
        sell_depth_usd: 50000 + Math.random() * 100000,
        fillable_size_usd: 15000 + Math.random() * 30000,
        signal_age_ms: Math.floor(Math.random() * 2000),
        signal_time: now,
        exchange_latency_ms: Math.floor(Math.random() * 500),
        confirmed_exchanges: 1,
        status: 'detected',
        notes: `Test signal batch | spread=${spread.toFixed(2)}bps | net=${netEdge.toFixed(2)}bps`,
      });
    }

    const created = await base44.asServiceRole.entities.ArbSignal.bulkCreate(signals);

    console.log(`Generated ${created.length} test signals`);

    return Response.json({
      ok: true,
      created: created.length,
      signals: created.slice(0, 5).map(s => ({
        id: s.id,
        pair: s.pair,
        net_edge_bps: s.net_edge_bps,
        status: s.status,
      })),
    });
  } catch (error) {
    console.error('generateTestSignals error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});