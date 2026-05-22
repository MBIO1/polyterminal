import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Droplet Health Monitor - Comprehensive health check
 * Monitors: TokenAuth, WebSocket health, signal flow, system metrics
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get latest heartbeat for droplet health
    const heartbeats = await base44.entities.ArbHeartbeat.list('-snapshot_time', 10);
    const latestHb = heartbeats[0];
    
    // Get recent signals for flow analysis
    const signals = await base44.entities.ArbSignal.list('-received_time', 50);
    
    // Get config for threshold comparison
    const configs = await base44.entities.ArbConfig.list('-created_date', 1);
    const config = configs[0] || null;

    // Health checks
    const health = {
      timestamp: new Date().toISOString(),
      overall_status: 'healthy',
      checks: {},
      metrics: {},
      alerts: [],
      recommendations: []
    };

    // 1. TokenAuth & Connectivity Check
    const lastHbTime = latestHb ? new Date(latestHb.snapshot_time).getTime() : 0;
    const now = Date.now();
    const hbAgeMs = now - lastHbTime;
    const hbAgeMin = Math.round(hbAgeMs / 60000);
    
    health.checks.tokenauth = {
      status: hbAgeMin < 3 ? 'healthy' : hbAgeMin < 10 ? 'degraded' : 'critical',
      details: `Last heartbeat: ${hbAgeMin}m ago`,
      last_heartbeat: latestHb?.snapshot_time || null
    };

    // 2. WebSocket Health
    const freshBooks = latestHb?.fresh_books || '';
    const btcConnected = freshBooks.includes('BTCUSDT:✓');
    const ethConnected = freshBooks.includes('ETHUSDT:✓');
    
    health.checks.websocket = {
      status: (btcConnected && ethConnected) ? 'healthy' : 'degraded',
      details: `BTC: ${btcConnected ? '✓' : '✗'} | ETH: ${ethConnected ? '✓' : '✗'}`,
      btc_connected: btcConnected,
      eth_connected: ethConnected
    };

    // 3. Signal Flow Analysis (last 10 heartbeats)
    const recentHbs = heartbeats.slice(0, 10);
    const totalEvals = recentHbs.reduce((sum, hb) => sum + (hb.evaluations || 0), 0);
    const totalPosted = recentHbs.reduce((sum, hb) => sum + (hb.posted || 0), 0);
    const totalErrors = recentHbs.reduce((sum, hb) => sum + (hb.post_errors || 0), 0);
    const totalNon2xx = recentHbs.reduce((sum, hb) => sum + (hb.post_non_2xx || 0), 0);
    
    const execRate = totalEvals > 0 ? (totalPosted / totalEvals * 100) : 0;
    
    health.checks.signal_flow = {
      status: (totalErrors === 0 && totalNon2xx === 0) ? 'healthy' : 'degraded',
      details: `${totalPosted} signals posted / ${totalEvals} evaluations (${execRate.toFixed(2)}%)`,
      evaluations: totalEvals,
      posted: totalPosted,
      execution_rate_pct: parseFloat(execRate.toFixed(2)),
      post_errors: totalErrors,
      post_non_2xx: totalNon2xx
    };

    // 4. Book Freshness & Staleness
    const totalStale = recentHbs.reduce((sum, hb) => sum + (hb.rejected_stale || 0), 0);
    const staleRate = totalEvals > 0 ? (totalStale / totalEvals * 100) : 0;
    
    health.checks.book_freshness = {
      status: staleRate < 1 ? 'healthy' : staleRate < 5 ? 'degraded' : 'critical',
      details: `${staleRate.toFixed(2)}% stale book rejections`,
      stale_rejections: totalStale,
      stale_rate_pct: parseFloat(staleRate.toFixed(2))
    };

    // 5. Edge Quality Analysis
    const bestEdges = recentHbs.map(hb => hb.best_edge_bps || 0);
    const avgBestEdge = bestEdges.length > 0 ? bestEdges.reduce((a, b) => a + b, 0) / bestEdges.length : 0;
    const peakEdge = Math.max(...bestEdges, 0);
    
    health.checks.edge_quality = {
      status: avgBestEdge >= 2 ? 'healthy' : avgBestEdge >= 1 ? 'degraded' : 'low_opportunity',
      details: `Avg best edge: ${avgBestEdge.toFixed(2)} bps | Peak: ${peakEdge.toFixed(2)} bps`,
      avg_best_edge_bps: parseFloat(avgBestEdge.toFixed(2)),
      peak_edge_bps: parseFloat(peakEdge.toFixed(2))
    };

    // 6. Rejection Analysis
    const totalRejectedEdge = recentHbs.reduce((sum, hb) => sum + (hb.rejected_edge || 0), 0);
    const totalRejectedFillable = recentHbs.reduce((sum, hb) => sum + (hb.rejected_fillable || 0), 0);
    const totalRejectedDedupe = recentHbs.reduce((sum, hb) => sum + (hb.rejected_dedupe || 0), 0);
    
    health.metrics.rejection_breakdown = {
      edge_filter: totalRejectedEdge,
      fillable_filter: totalRejectedFillable,
      dedupe_filter: totalRejectedDedupe,
      stale_filter: totalStale
    };

    // 7. Signal Latency from live droplet payload, not old stored signal age
    const recentSignals = signals.slice(0, 20);
    const liveSignalLatencyValues = recentSignals
      .map(s => Number(s.signal_age_ms || 0))
      .filter(v => Number.isFinite(v) && v > 0);
    const avgSignalAge = liveSignalLatencyValues.length > 0
      ? liveSignalLatencyValues.reduce((sum, v) => sum + v, 0) / liveSignalLatencyValues.length
      : 0;
    
    health.checks.signal_latency = {
      status: liveSignalLatencyValues.length === 0 ? 'degraded' : avgSignalAge < 1500 ? 'healthy' : avgSignalAge < 5000 ? 'degraded' : 'critical',
      details: liveSignalLatencyValues.length === 0 ? 'No recent live signal latency data' : `Avg signal age: ${(avgSignalAge/1000).toFixed(1)}s`,
      avg_age_ms: Math.round(avgSignalAge)
    };

    // 8. Gateway Performance
    const lastHb = latestHb;
    if (lastHb) {
      health.metrics.gateway_performance = {
        passed_edge_gate: lastHb.passed_edge_gate || 0,
        passed_fillable_gate: lastHb.passed_fillable_gate || 0,
        passed_stale_gate: lastHb.passed_stale_gate || 0,
        passed_dedupe_gate: lastHb.passed_dedupe_gate || 0,
        venue_pair_checks: lastHb.venue_pair_checks || 0,
        venue_no_book: lastHb.venue_no_book || 0,
        venue_stale_book: lastHb.venue_stale_book || 0
      };
    }

    // Determine overall status
    const criticalChecks = Object.values(health.checks).filter(c => c.status === 'critical');
    const degradedChecks = Object.values(health.checks).filter(c => c.status === 'degraded');
    
    if (criticalChecks.length > 0) {
      health.overall_status = 'critical';
    } else if (degradedChecks.length > 0) {
      health.overall_status = 'degraded';
    }

    // Generate alerts
    if (hbAgeMin >= 3) {
      health.alerts.push({
        severity: hbAgeMin >= 10 ? 'critical' : 'warning',
        message: `Droplet heartbeat is ${hbAgeMin}m old - possible connectivity issue`
      });
    }

    if (!btcConnected || !ethConnected) {
      health.alerts.push({
        severity: 'warning',
        message: `WebSocket connection missing for ${!btcConnected ? 'BTC' : ''}${!btcConnected && !ethConnected ? ' & ' : ''}${!ethConnected ? 'ETH' : ''}`
      });
    }

    if (totalErrors > 0 || totalNon2xx > 0) {
      health.alerts.push({
        severity: 'critical',
        message: `Signal POST failures detected: ${totalErrors} errors, ${totalNon2xx} non-2xx responses`
      });
    }

    if (staleRate >= 5) {
      health.alerts.push({
        severity: 'warning',
        message: `High stale book rate (${staleRate.toFixed(1)}%) - possible API rate limiting`
      });
    }

    if (liveSignalLatencyValues.length > 0 && avgSignalAge >= 5000) {
      health.alerts.push({
        severity: avgSignalAge >= 15000 ? 'critical' : 'warning',
        message: `Signal ingestion latency high (${(avgSignalAge/1000).toFixed(1)}s avg)`
      });
    }

    // Generate recommendations
    if (avgBestEdge < 1 && config) {
      const floorBps = config.btc_min_edge_bps || 2;
      if (floorBps > 2) {
        health.recommendations.push({
          priority: 'low',
          action: `Consider lowering min_edge_floor from ${floorBps} to 0.5-1 bps to capture more opportunities`
        });
      }
    }

    if (totalRejectedFillable > totalRejectedEdge * 0.1 && config) {
      health.recommendations.push({
        priority: 'medium',
        action: `High fillable rejections - consider increasing min_fillable_usd from $${config.min_fillable_usd || 500}`
      });
    }

    return Response.json({ health });
  } catch (error) {
    return Response.json({ 
      error: 'Health check failed',
      details: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});