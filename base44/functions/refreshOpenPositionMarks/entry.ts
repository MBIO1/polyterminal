import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Scheduled: updates spot_mark / perp_mark / notionals / net_delta_usd on all
// OPEN ArbLivePosition snapshots, using live OKX tickers.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const host = 'https://www.okx.com';

    async function getTicker(instId) {
      const res = await fetch(`${host}/api/v5/market/ticker?instId=${instId}`);
      const json = await res.json().catch(() => null);
      const last = json?.data?.[0]?.last;
      return last ? Number(last) : null;
    }

    const openPositions = await base44.asServiceRole.entities.ArbLivePosition.filter({ status: 'Open' });
    if (!openPositions.length) {
      return Response.json({ ok: true, updated: 0, reason: 'no open positions' });
    }

    // Cache tickers per asset to avoid duplicate fetches
    const markCache = {}; // { BTC: { spot, perp }, ... }
    async function marksFor(asset) {
      if (markCache[asset]) return markCache[asset];
      const [spot, perp] = await Promise.all([
        getTicker(`${asset}-USDT`),
        getTicker(`${asset}-USDT-SWAP`),
      ]);
      markCache[asset] = { spot, perp };
      return markCache[asset];
    }

    let updated = 0;
    for (const pos of openPositions) {
      if (!pos.asset) continue;
      const { spot, perp } = await marksFor(pos.asset);
      if (spot == null || perp == null) continue;

      const spot_notional = pos.spot_qty != null ? pos.spot_qty * spot : pos.spot_notional;
      const perp_notional = pos.perp_qty != null ? pos.perp_qty * perp : pos.perp_notional;
      const net_delta_usd = (spot_notional || 0) + (perp_notional || 0);

      await base44.asServiceRole.entities.ArbLivePosition.update(pos.id, {
        spot_mark: spot,
        perp_mark: perp,
        spot_notional,
        perp_notional,
        net_delta_usd,
        snapshot_time: new Date().toISOString(),
      });
      updated++;
    }

    return Response.json({ ok: true, updated, total_open: openPositions.length });
  } catch (error) {
    console.error('refreshOpenPositionMarks error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});