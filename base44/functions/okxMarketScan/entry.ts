import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Public OKX market scanner: spot vs perp spread + funding for BTC/ETH/SOL.
// No API keys required (public endpoints only).
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const host = 'https://www.okx.com';
    const assets = ['BTC', 'ETH', 'SOL'];

    async function getJson(path) {
      const res = await fetch(`${host}${path}`);
      const text = await res.text();
      try { return JSON.parse(text); } catch { return null; }
    }

    const rows = await Promise.all(assets.map(async (asset) => {
      const spotInst = `${asset}-USDT`;
      const perpInst = `${asset}-USDT-SWAP`;

      const [spotTk, perpTk, fundingRate] = await Promise.all([
        getJson(`/api/v5/market/ticker?instId=${spotInst}`),
        getJson(`/api/v5/market/ticker?instId=${perpInst}`),
        getJson(`/api/v5/public/funding-rate?instId=${perpInst}`),
      ]);

      const spot = spotTk?.data?.[0] || null;
      const perp = perpTk?.data?.[0] || null;
      const fund = fundingRate?.data?.[0] || null;

      const spotPx = spot ? Number(spot.last) : null;
      const perpPx = perp ? Number(perp.last) : null;
      const spread = (spotPx && perpPx) ? perpPx - spotPx : null;
      const spreadBps = (spread !== null && spotPx) ? (spread / spotPx) * 10000 : null;

      return {
        asset,
        spot_instrument: spotInst,
        perp_instrument: perpInst,
        spot_price: spotPx,
        perp_price: perpPx,
        spot_bid: spot ? Number(spot.bidPx) : null,
        spot_ask: spot ? Number(spot.askPx) : null,
        perp_bid: perp ? Number(perp.bidPx) : null,
        perp_ask: perp ? Number(perp.askPx) : null,
        spot_vol_24h_usd: spot ? Number(spot.volCcy24h) : null,
        basis_abs: spread,
        basis_bps: spreadBps,
        funding_rate: fund ? Number(fund.fundingRate) : null,
        next_funding_rate: fund ? Number(fund.nextFundingRate) : null,
        funding_time: fund ? Number(fund.fundingTime) : null,
        next_funding_time: fund ? Number(fund.nextFundingTime) : null,
      };
    }));

    return Response.json({
      timestamp: Date.now(),
      exchange: 'OKX',
      rows,
    });
  } catch (error) {
    console.error('okxMarketScan error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});