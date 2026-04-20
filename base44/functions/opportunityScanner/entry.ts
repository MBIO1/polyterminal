// Scans OKX for basis opportunities that meet or exceed the configured
// per-asset minimum edge, and fires a Slack+Telegram alert for each hit.
// De-dupes so we only alert when an asset re-crosses the threshold.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const host = 'https://www.okx.com';

// In-memory dedupe (persists for the life of the function instance).
// Maps asset -> 'above' | 'below' relative to threshold.
const lastState = {};

async function getJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function fetchRow(asset) {
  const spotId = `${asset}-USDT`;
  const perpId = `${asset}-USDT-SWAP`;
  const [spot, perp, funding] = await Promise.all([
    getJson(`${host}/api/v5/market/ticker?instId=${spotId}`),
    getJson(`${host}/api/v5/market/ticker?instId=${perpId}`),
    getJson(`${host}/api/v5/public/funding-rate?instId=${perpId}`),
  ]);
  const spot_price = Number(spot?.data?.[0]?.last);
  const perp_price = Number(perp?.data?.[0]?.last);
  if (!spot_price || !perp_price) return null;
  const basis_abs = perp_price - spot_price;
  const basis_bps = (basis_abs / spot_price) * 10_000;
  const funding_rate = Number(funding?.data?.[0]?.fundingRate ?? 0);
  return { asset, spot_price, perp_price, basis_abs, basis_bps, funding_rate };
}

function minEdgeFor(asset, config) {
  if (asset === 'BTC') return Number(config?.btc_min_edge_bps ?? 15);
  if (asset === 'ETH') return Number(config?.eth_min_edge_bps ?? 20);
  return 25; // default for other assets
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const cfgList = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config = cfgList[0] || {};

    const assets = ['BTC', 'ETH', 'SOL'];
    const rows = (await Promise.all(assets.map(fetchRow))).filter(Boolean);

    const hits = [];
    for (const r of rows) {
      const threshold = minEdgeFor(r.asset, config);
      const absBps = Math.abs(r.basis_bps);
      const isHit = absBps >= threshold;
      const prev = lastState[r.asset];
      const newState = isHit ? 'above' : 'below';
      lastState[r.asset] = newState;

      if (isHit && prev !== 'above') {
        hits.push({ ...r, threshold });
      }
    }

    if (hits.length === 0) {
      return Response.json({ ok: true, rows: rows.length, hits: 0 });
    }

    // Fire alerts for each hit (fan-out Slack + Telegram via slackAlert)
    await Promise.all(hits.map(h => {
      const direction = h.basis_bps >= 0
        ? 'Long Spot / Short Perp'
        : 'Short Spot / Long Perp';
      return base44.asServiceRole.functions.invoke('slackAlert', {
        alert_type: 'funding_anomaly',
        severity: 'High',
        title: `${h.asset} basis ${h.basis_bps.toFixed(1)} bps`,
        description: `Edge crossed threshold (${h.threshold} bps). Suggested direction: ${direction}.`,
        fields: [
          { title: 'Asset', value: h.asset },
          { title: 'Spot', value: h.spot_price.toFixed(2) },
          { title: 'Perp', value: h.perp_price.toFixed(2) },
          { title: 'Basis $', value: h.basis_abs.toFixed(2) },
          { title: 'Basis bps', value: h.basis_bps.toFixed(2) },
          { title: 'Funding', value: `${(h.funding_rate * 100).toFixed(4)}%` },
          { title: 'Threshold', value: `${h.threshold} bps` },
        ],
      });
    }));

    return Response.json({ ok: true, rows: rows.length, hits: hits.length, assets: hits.map(h => h.asset) });
  } catch (error) {
    console.error('opportunityScanner error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});