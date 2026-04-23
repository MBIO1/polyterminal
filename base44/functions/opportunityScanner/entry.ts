// Scans OKX for basis opportunities that meet or exceed the configured
// per-asset minimum edge, fires Slack+Telegram alerts, AND injects signals
// into the ArbSignal pipeline so the executor can act on them.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const host = 'https://www.okx.com';

// In-memory dedupe (persists for the life of the function instance).
const lastState = {};

async function getJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function fetchRow(asset) {
  const spotId = `${asset}-USDT`;
  const perpId = `${asset}-USDT-SWAP`;
  const [spotRes, perpRes, fundingRes, spotBook, perpBook] = await Promise.all([
    getJson(`${host}/api/v5/market/ticker?instId=${spotId}`),
    getJson(`${host}/api/v5/market/ticker?instId=${perpId}`),
    getJson(`${host}/api/v5/public/funding-rate?instId=${perpId}`),
    getJson(`${host}/api/v5/market/books?instId=${spotId}&sz=5`),
    getJson(`${host}/api/v5/market/books?instId=${perpId}&sz=5`),
  ]);
  const spot_price = Number(spotRes?.data?.[0]?.last);
  const perp_price = Number(perpRes?.data?.[0]?.last);
  if (!spot_price || !perp_price) return null;
  const basis_abs = perp_price - spot_price;
  const basis_bps = (basis_abs / spot_price) * 10_000;
  const funding_rate = Number(fundingRes?.data?.[0]?.fundingRate ?? 0);

  // Extract top-of-book for sizing
  const spotAsk = Number(spotBook?.data?.[0]?.asks?.[0]?.[0] || spot_price);
  const spotAskSz = Number(spotBook?.data?.[0]?.asks?.[0]?.[1] || 0);
  const perpBid = Number(perpBook?.data?.[0]?.bids?.[0]?.[0] || perp_price);
  const perpBidSz = Number(perpBook?.data?.[0]?.bids?.[0]?.[1] || 0);
  const spotBid = Number(spotBook?.data?.[0]?.bids?.[0]?.[0] || spot_price);
  const spotBidSz = Number(spotBook?.data?.[0]?.bids?.[0]?.[1] || 0);
  const perpAsk = Number(perpBook?.data?.[0]?.asks?.[0]?.[0] || perp_price);
  const perpAskSz = Number(perpBook?.data?.[0]?.asks?.[0]?.[1] || 0);

  // Pick direction: contango (long spot/short perp) vs backwardation
  let buy_exchange, sell_exchange, buy_price, sell_price, buy_depth_usd, sell_depth_usd, raw_spread_bps;
  if (basis_bps >= 0) {
    // Contango: buy spot, sell perp
    raw_spread_bps = ((perpBid - spotAsk) / spotAsk) * 10_000;
    buy_exchange = 'OKX-spot'; sell_exchange = 'OKX-perp';
    buy_price = spotAsk; sell_price = perpBid;
    buy_depth_usd = spotAskSz * spotAsk; sell_depth_usd = perpBidSz * perpBid;
  } else {
    // Backwardation: buy perp, sell spot
    raw_spread_bps = ((spotBid - perpAsk) / perpAsk) * 10_000;
    buy_exchange = 'OKX-perp'; sell_exchange = 'OKX-spot';
    buy_price = perpAsk; sell_price = spotBid;
    buy_depth_usd = perpAskSz * perpAsk; sell_depth_usd = spotBidSz * spotBid;
  }

  const fillable_size_usd = Math.min(buy_depth_usd, sell_depth_usd);

  return {
    asset, spot_price, perp_price, basis_abs, basis_bps, funding_rate,
    buy_exchange, sell_exchange, buy_price, sell_price,
    raw_spread_bps, buy_depth_usd, sell_depth_usd, fillable_size_usd,
    pair: `${asset}-USDT`,
  };
}

function minEdgeFor(asset, config) {
  if (asset === 'BTC') return Number(config?.btc_min_edge_bps ?? 3);
  if (asset === 'ETH') return Number(config?.eth_min_edge_bps ?? 3);
  return 3;
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

      // Always inject if above threshold (not just on state transition) so executor has fresh signals
      if (isHit) {
        hits.push({ ...r, threshold });
      }
    }

    if (hits.length === 0) {
      return Response.json({ ok: true, rows: rows.length, hits: 0 });
    }

    const TAKER_FEE_BPS = Number(config?.taker_fee_bps_per_leg ?? 2);
    const now = new Date().toISOString();

    await Promise.all(hits.map(async h => {
      const net_edge_bps = h.raw_spread_bps - 4 * TAKER_FEE_BPS;
      const direction = h.basis_bps >= 0 ? 'Long Spot / Short Perp' : 'Short Spot / Long Perp';
      const prevState = lastState[h.asset];

      // --- Inject into ArbSignal pipeline so executor can trade it ---
      // Dedupe: skip if same pair+route already ingested in last 30s
      const recent = await base44.asServiceRole.entities.ArbSignal.filter(
        { pair: h.pair, buy_exchange: h.buy_exchange, sell_exchange: h.sell_exchange },
        '-received_time', 1,
      );
      const lastAge = recent[0]
        ? Date.now() - new Date(recent[0].received_time || recent[0].created_date).getTime()
        : Infinity;

      if (lastAge >= 30_000) {
        await base44.asServiceRole.entities.ArbSignal.create({
          signal_time: now,
          received_time: now,
          pair: h.pair,
          asset: h.asset,
          buy_exchange: h.buy_exchange,
          sell_exchange: h.sell_exchange,
          buy_price: h.buy_price,
          sell_price: h.sell_price,
          raw_spread_bps: h.raw_spread_bps,
          net_edge_bps,
          buy_depth_usd: h.buy_depth_usd,
          sell_depth_usd: h.sell_depth_usd,
          fillable_size_usd: h.fillable_size_usd,
          signal_age_ms: 0,
          exchange_latency_ms: 0,
          confirmed_exchanges: 1,
          status: net_edge_bps >= 20 ? 'alerted' : 'detected',
          notes: `OKX scanner: ${direction} | basis=${h.basis_bps.toFixed(2)}bps | funding=${(h.funding_rate * 100).toFixed(4)}%`,
        });
      }

      // --- Alert (only on threshold crossing, not every run) ---
      if (prevState !== 'above') {
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
            { title: 'Net edge bps', value: net_edge_bps.toFixed(2) },
            { title: 'Funding', value: `${(h.funding_rate * 100).toFixed(4)}%` },
            { title: 'Threshold', value: `${h.threshold} bps` },
          ],
        });
      }
    }));

    return Response.json({ ok: true, rows: rows.length, hits: hits.length, assets: hits.map(h => h.asset) });
  } catch (error) {
    console.error('opportunityScanner error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});