// scanFunding — polls OKX + Bybit funding-rate REST endpoints for a curated pair list
// and writes one ArbFundingOpportunity per venue/pair snapshot.
//
// Funding conventions (both OKX and Bybit):
//   - Published as a decimal per 8-hour interval (e.g. 0.0001 = 0.01% per 8h)
//   - POSITIVE funding → longs pay shorts → SHORT the perp + LONG spot to capture
//   - NEGATIVE funding → shorts pay longs → LONG the perp + SHORT spot to capture
//   - Annualized APR = rate × (24/8) × 365 × 10000 bps
//
// Returns summary of opportunities found and written.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const PAIRS = [
  'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'AVAX-USDT', 'LINK-USDT',
  'DOGE-USDT', 'ADA-USDT', 'ATOM-USDT', 'APT-USDT', 'SUI-USDT',
  'ARB-USDT', 'OP-USDT', 'INJ-USDT', 'SEI-USDT', 'TIA-USDT',
];

// OKX: GET /api/v5/public/funding-rate?instId=BTC-USDT-SWAP
async function fetchOkxFunding(pair) {
  const instId = `${pair}-SWAP`;
  const res = await fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`);
  if (!res.ok) throw new Error(`OKX ${pair}: HTTP ${res.status}`);
  const json = await res.json();
  const row = json?.data?.[0];
  if (!row) return null;
  return {
    funding_rate: Number(row.fundingRate),
    next_funding_time: new Date(Number(row.nextFundingTime)).toISOString(),
    interval_hours: 8,
  };
}

// Bybit v5: GET /v5/market/tickers?category=linear&symbol=BTCUSDT
async function fetchBybitFunding(pair) {
  const symbol = pair.replace('-', '');
  const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`);
  if (!res.ok) throw new Error(`Bybit ${pair}: HTTP ${res.status}`);
  const json = await res.json();
  const row = json?.result?.list?.[0];
  if (!row) return null;
  return {
    funding_rate: Number(row.fundingRate),
    next_funding_time: new Date(Number(row.nextFundingTime)).toISOString(),
    interval_hours: 8,
    mark_price: Number(row.markPrice),
  };
}

function annualizeBps(rate, intervalHours) {
  // rate is decimal per interval. Per-year = rate × (24/interval) × 365. In bps × 10000.
  return rate * (24 / intervalHours) * 365 * 10000;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Load config to know threshold
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config = configs?.[0] || {};
    const minAprBps = Number(config.funding_min_apr_bps ?? 1000);

    const snapshotTime = new Date().toISOString();
    const toCreate = [];
    const errors = [];

    // Fan out all fetches in parallel
    const tasks = [];
    for (const pair of PAIRS) {
      tasks.push(
        fetchOkxFunding(pair).then(r => ({ venue: 'OKX', pair, r })).catch(e => ({ venue: 'OKX', pair, err: e.message })),
        fetchBybitFunding(pair).then(r => ({ venue: 'Bybit', pair, r })).catch(e => ({ venue: 'Bybit', pair, err: e.message })),
      );
    }
    const results = await Promise.all(tasks);

    for (const res of results) {
      if (res.err) { errors.push(`${res.venue} ${res.pair}: ${res.err}`); continue; }
      if (!res.r) continue;
      const apr = annualizeBps(res.r.funding_rate, res.r.interval_hours);
      const qualifies = Math.abs(apr) >= minAprBps;
      toCreate.push({
        snapshot_time: snapshotTime,
        venue: res.venue,
        pair: res.pair,
        asset: res.pair.split('-')[0],
        funding_rate: res.r.funding_rate,
        funding_interval_hours: res.r.interval_hours,
        annualized_apr_bps: Number(apr.toFixed(2)),
        next_funding_time: res.r.next_funding_time,
        mark_price: res.r.mark_price ?? null,
        qualifies,
        direction: apr >= 0 ? 'short_perp' : 'long_perp',
      });
    }

    // Bulk insert
    if (toCreate.length > 0) {
      await base44.asServiceRole.entities.ArbFundingOpportunity.bulkCreate(toCreate);
    }

    const qualifying = toCreate.filter(x => x.qualifies);
    qualifying.sort((a, b) => Math.abs(b.annualized_apr_bps) - Math.abs(a.annualized_apr_bps));

    return Response.json({
      ok: true,
      snapshot_time: snapshotTime,
      scanned: toCreate.length,
      qualifying: qualifying.length,
      min_apr_bps: minAprBps,
      top: qualifying.slice(0, 10).map(x => ({
        venue: x.venue, pair: x.pair, apr_bps: x.annualized_apr_bps, direction: x.direction,
      })),
      errors,
    });
  } catch (error) {
    console.error('scanFunding error:', error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});