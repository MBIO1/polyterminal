// Aggregates ArbHeartbeat rows to answer: "is the bot being productive when it's silent?"
//
// POST body (optional):
// { window_hours: 24 } // default 24
//
// Returns:
// {
// window_hours, heartbeat_count, total_evaluations,
// peak_edge_bps_1h, peak_edge_bps_4h, peak_edge_bps_24h,
// distribution: { b0_5, b5_10, b10_15, b15_20, b20_plus },
// by_hour: [ { hour_iso, peak_edge_bps, posted, opps_5_20 } ],
// // Shadow-PnL: "what if the floor were lower?"
// // Estimates round-trip net PnL bps-weighted, assuming 50% of near-miss edge is retained
// // after adverse selection & latency (conservative).
// shadow_pnl: [ { floor_bps, opportunities, est_net_bps_per_trade, est_total_bps } ],
// verdict: "healthy" | "too_conservative" | "broken" | "market_dead"
// }

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Assume 50% edge retention after slippage & latency on near-miss trades.
// This is intentionally conservative — real fills at 12-15 bps often decay 40-60%.
const RETENTION_FRACTION = 0.5;

function bucketMidpoint(bucket) {
  // Midpoint of the bucket, minus round-trip fees already netted in by the bot
  switch (bucket) {
    case 'bucket_5_10': return 7.5;
    case 'bucket_10_15': return 12.5;
    case 'bucket_15_20': return 17.5;
    case 'bucket_20_plus': return 25; // conservative average
    default: return 0;
  }
}

function shadowPnlAt(floorBps, heartbeats) {
  const buckets = [
    { key: 'bucket_5_10', low: 5 },
    { key: 'bucket_10_15', low: 10 },
    { key: 'bucket_15_20', low: 15 },
    { key: 'bucket_20_plus', low: 20 },
  ];
  let opps = 0;
  let totalBps = 0;
  for (const b of buckets) {
    if (b.low < floorBps) continue;
    const count = heartbeats.reduce((a, h) => a + (Number(h[b.key]) || 0), 0);
    opps += count;
    totalBps += count * bucketMidpoint(b.key) * RETENTION_FRACTION;
  }
  return {
    floor_bps: floorBps,
    opportunities: opps,
    est_net_bps_per_trade: opps > 0 ? +(totalBps / opps).toFixed(2) : 0,
    est_total_bps: +totalBps.toFixed(1),
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try {
      user = await base44.auth.me();
    } catch (authError) {
      console.warn('botProductivity: auth check failed, returning no_data');
      return Response.json({
        window_hours: 24,
        heartbeat_count: 0,
        verdict: 'no_data',
        message: 'Authentication failed. Returning empty stats.',
      });
    }

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const windowHours = Math.max(1, Math.min(Number(body.window_hours) || 24, 168));

    const since = Date.now() - windowHours * 3600 * 1000;
    const all = await base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 5000);
    const hbs = all.filter(h => new Date(h.snapshot_time).getTime() >= since);

    if (hbs.length === 0) {
      return Response.json({
        window_hours: windowHours,
        heartbeat_count: 0,
        verdict: 'no_data',
        message: 'No heartbeats received yet. Make sure the droplet bot is POSTing to /functions/ingestHeartbeat.',
      });
    }

    const now = Date.now();
    const within = ms => hbs.filter(h => now - new Date(h.snapshot_time).getTime() <= ms);
    const peak = arr => arr.reduce((m, h) => Math.max(m, Number(h.best_edge_bps) || 0), 0);

    const peak1h = peak(within(3600 * 1000));
    const peak4h = peak(within(4 * 3600 * 1000));
    const peak24h = peak(within(24 * 3600 * 1000));

    const distribution = {
      b0_5: hbs.reduce((a, h) => a + (Number(h.bucket_0_5) || 0), 0),
      b5_10: hbs.reduce((a, h) => a + (Number(h.bucket_5_10) || 0), 0),
      b10_15: hbs.reduce((a, h) => a + (Number(h.bucket_10_15) || 0), 0),
      b15_20: hbs.reduce((a, h) => a + (Number(h.bucket_15_20) || 0), 0),
      b20_plus: hbs.reduce((a, h) => a + (Number(h.bucket_20_plus) || 0), 0),
    };

    // Bucket by calendar hour
    const hourMap = new Map();
    for (const h of hbs) {
      const hr = new Date(h.snapshot_time);
      hr.setMinutes(0, 0, 0);
      const key = hr.toISOString();
      const cur = hourMap.get(key) || { hour_iso: key, peak_edge_bps: 0, posted: 0, opps_5_20: 0 };
      cur.peak_edge_bps = Math.max(cur.peak_edge_bps, Number(h.best_edge_bps) || 0);
      cur.posted += Number(h.posted) || 0;
      cur.opps_5_20 += (Number(h.bucket_5_10) || 0) + (Number(h.bucket_10_15) || 0) + (Number(h.bucket_15_20) || 0);
      hourMap.set(key, cur);
    }
    const byHour = [...hourMap.values()].sort((a, b) => a.hour_iso.localeCompare(b.hour_iso));

    const shadowPnl = [10, 12, 15, 18, 20].map(f => shadowPnlAt(f, hbs));

    // Verdict logic
    let verdict;
    const executed = distribution.b20_plus;
    const nearMiss = distribution.b15_20 + distribution.b10_15;
    if (executed > 0) {
      verdict = 'healthy';
    } else if (peak24h < 3) {
      verdict = 'market_dead'; // nothing on offer anywhere
    } else if (nearMiss >= 20 && peak24h >= 12) {
      verdict = 'too_conservative'; // 10-20 bps opportunities piling up we never fire on
    } else if (peak24h < 10 && nearMiss < 5) {
      verdict = 'market_dead';
    } else {
      verdict = 'healthy';
    }

    const totalEval = hbs.reduce((a, h) => a + (Number(h.evaluations) || 0), 0);

    return Response.json({
      window_hours: windowHours,
      heartbeat_count: hbs.length,
      total_evaluations: totalEval,
      peak_edge_bps_1h: +peak1h.toFixed(2),
      peak_edge_bps_4h: +peak4h.toFixed(2),
      peak_edge_bps_24h: +peak24h.toFixed(2),
      distribution,
      by_hour: byHour,
      shadow_pnl: shadowPnl,
      verdict,
    });
  } catch (error) {
    console.error('botProductivity error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});