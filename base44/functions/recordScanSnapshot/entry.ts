import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Scheduled function: records OKX basis + funding snapshots for BTC/ETH/SOL.
// Runs via scheduled automation (e.g. every 5 minutes).
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const host = 'https://www.okx.com';
    const assets = ['BTC', 'ETH', 'SOL'];
    const now = new Date().toISOString();

    async function getJson(path) {
      const res = await fetch(`${host}${path}`);
      const text = await res.text();
      try { return JSON.parse(text); } catch { return null; }
    }

    const snapshots = await Promise.all(assets.map(async (asset) => {
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
        snapshot_time: now,
        asset,
        spot_price: spotPx,
        perp_price: perpPx,
        basis_abs: spread,
        basis_bps: spreadBps,
        funding_rate: fund ? Number(fund.fundingRate) : null,
        next_funding_rate: fund ? Number(fund.nextFundingRate) : null,
        exchange: 'OKX',
      };
    }));

    const valid = snapshots.filter(s => s.spot_price && s.perp_price);
    if (valid.length > 0) {
      await base44.asServiceRole.entities.ArbScanSnapshot.bulkCreate(valid);
    }

    return Response.json({ ok: true, recorded: valid.length, timestamp: now });
  } catch (error) {
    console.error('recordScanSnapshot error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});