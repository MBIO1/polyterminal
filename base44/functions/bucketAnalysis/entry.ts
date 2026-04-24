import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Analyzes heartbeat bucket distribution to identify where opportunities cluster
 * and which gates are filtering them out. Returns actionable metrics for tuning config.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    // Fetch recent heartbeats (last 24h)
    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const heartbeats = await base44.asServiceRole.entities.ArbHeartbeat.filter(
      { snapshot_time: { $gte: cutoff } },
      '-snapshot_time',
      288 // ~12 per hour × 24h
    );

    if (heartbeats.length === 0) {
      return Response.json({ ok: true, message: 'No heartbeat data in last 24h' });
    }

    // Aggregate bucket distribution
    const agg = {
      total_evaluations: 0,
      total_posted: 0,
      bucket_0_5: 0,
      bucket_5_10: 0,
      bucket_10_15: 0,
      bucket_15_20: 0,
      bucket_20_plus: 0,
      rejected_edge: 0,
      rejected_fillable: 0,
      rejected_stale: 0,
      rejected_dedupe: 0,
      post_errors: 0,
      post_non_2xx: 0,
    };

    for (const hb of heartbeats) {
      agg.total_evaluations += Number(hb.evaluations || 0);
      agg.total_posted += Number(hb.posted || 0);
      agg.bucket_0_5 += Number(hb.bucket_0_5 || 0);
      agg.bucket_5_10 += Number(hb.bucket_5_10 || 0);
      agg.bucket_10_15 += Number(hb.bucket_10_15 || 0);
      agg.bucket_15_20 += Number(hb.bucket_15_20 || 0);
      agg.bucket_20_plus += Number(hb.bucket_20_plus || 0);
      agg.rejected_edge += Number(hb.rejected_edge || 0);
      agg.rejected_fillable += Number(hb.rejected_fillable || 0);
      agg.rejected_stale += Number(hb.rejected_stale || 0);
      agg.rejected_dedupe += Number(hb.rejected_dedupe || 0);
      agg.post_errors += Number(hb.post_errors || 0);
      agg.post_non_2xx += Number(hb.post_non_2xx || 0);
    }

    // Calculate percentages and identify bottleneck
    const total = agg.total_evaluations || 1;
    const bucketDist = {
      '0–5 bps': { count: agg.bucket_0_5, pct: ((agg.bucket_0_5 / total) * 100).toFixed(1) },
      '5–10 bps': { count: agg.bucket_5_10, pct: ((agg.bucket_5_10 / total) * 100).toFixed(1) },
      '10–15 bps': { count: agg.bucket_10_15, pct: ((agg.bucket_10_15 / total) * 100).toFixed(1) },
      '15–20 bps': { count: agg.bucket_15_20, pct: ((agg.bucket_15_20 / total) * 100).toFixed(1) },
      '20+ bps': { count: agg.bucket_20_plus, pct: ((agg.bucket_20_plus / total) * 100).toFixed(1) },
    };

    const rejectionDist = {
      edge_floor: { count: agg.rejected_edge, pct: ((agg.rejected_edge / total) * 100).toFixed(1) },
      fillable_liquidity: { count: agg.rejected_fillable, pct: ((agg.rejected_fillable / total) * 100).toFixed(1) },
      stale_book: { count: agg.rejected_stale, pct: ((agg.rejected_stale / total) * 100).toFixed(1) },
      deduplication: { count: agg.rejected_dedupe, pct: ((agg.rejected_dedupe / total) * 100).toFixed(1) },
    };

    // Identify primary bottleneck
    let primaryBottleneck = 'unknown';
    let bottleneckPct = 0;
    for (const [gate, data] of Object.entries(rejectionDist)) {
      if (Number(data.pct) > bottleneckPct) {
        bottleneckPct = Number(data.pct);
        primaryBottleneck = gate;
      }
    }

    // Health assessment
    let health = 'HEALTHY';
    let recommendation = '';
    if (bottleneckPct > 80) {
      health = 'CRITICAL';
      if (primaryBottleneck === 'edge_floor') {
        recommendation = 'Fee stack is killing you. Switch to hybrid maker/taker: cut cost from 8→4 bps. Then lower min_edge_bps by 0.5–1 bps.';
      } else if (primaryBottleneck === 'fillable_liquidity') {
        recommendation = 'Liquidity gate too tight. Lower min_fillable_usd from 500 → 300–350. Monitor slippage degradation.';
      } else if (primaryBottleneck === 'stale_book') {
        recommendation = 'Book freshness issue. Increase websocket redundancy or lower signal_ttl_ms. Check exchange connectivity.';
      }
    } else if (bottleneckPct > 60) {
      health = 'DEGRADED';
      recommendation = `${primaryBottleneck} is filtering ${bottleneckPct.toFixed(1)}% of opportunities. Consider mild tuning.`;
    } else if (agg.total_posted > 0 && (agg.total_posted / total * 100) > 5) {
      health = 'HEALTHY';
      recommendation = `Execution rate healthy (~${((agg.total_posted / total) * 100).toFixed(1)}%). Monitor daily win rate.`;
    }

    // Network health
    const networkHealth = agg.post_errors + agg.post_non_2xx > 0 ? 'WARNING' : 'GOOD';

    return Response.json({
      ok: true,
      analysis_window: `Last ${heartbeats.length} heartbeats (~${(heartbeats.length / 12).toFixed(1)}h)`,
      aggregate: agg,
      bucket_distribution: bucketDist,
      rejection_distribution: rejectionDist,
      primary_bottleneck: primaryBottleneck,
      bottleneck_pct: bottleneckPct.toFixed(1),
      execution_rate_pct: ((agg.total_posted / total) * 100).toFixed(2),
      health,
      network_health: networkHealth,
      recommendation,
    });
  } catch (error) {
    console.error('bucketAnalysis error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});