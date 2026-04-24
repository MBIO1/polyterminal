import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    let user = null;
    try {
      user = await base44.auth.me();
    } catch (authError) {
      console.warn('dropletHealth: auth check failed, returning unknown status');
      return Response.json({
        overall_status: 'unknown',
        issues: ['authentication_unavailable'],
        heartbeat: { status: 'unknown', last_seen_sec: null },
        connectivity: { post_errors_last_hour: 0, non_2xx_last_hour: 0, issues: [] },
        signal_flow: { status: 'unknown', signals_ingested_last_hour: 0 },
        websocket_books: { status: 'unknown', details: 'Auth failed' },
        recommendations: [],
        diagnostics: null,
        checked_at: new Date().toISOString(),
      });
    }

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch latest heartbeat
    const heartbeats = await base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 1);
    const latestHeartbeat = heartbeats?.[0];

    // Fetch recent signals (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentSignals = await base44.asServiceRole.entities.ArbSignal.filter(
      { received_time: { $gte: oneHourAgo } },
      '-received_time'
    );

    // Calculate heartbeat status
    const lastHeartbeatMs = latestHeartbeat
      ? Date.now() - new Date(latestHeartbeat.snapshot_time).getTime()
      : null;

    const heartbeatStatus = {
      status: lastHeartbeatMs === null ? 'unknown' : lastHeartbeatMs < 120_000 ? 'healthy' : 'critical',
      last_seen_sec: lastHeartbeatMs ? Math.floor(lastHeartbeatMs / 1000) : null,
      heartbeats_last_hour: heartbeats.filter(h => {
        const hTime = new Date(h.snapshot_time).getTime();
        return Date.now() - hTime < 60 * 60 * 1000;
      }).length,
      total_evaluations_last_hour: heartbeats
        .filter(h => Date.now() - new Date(h.snapshot_time).getTime() < 60 * 60 * 1000)
        .reduce((sum, h) => sum + (h.evaluations || 0), 0),
      total_posted_last_hour: heartbeats
        .filter(h => Date.now() - new Date(h.snapshot_time).getTime() < 60 * 60 * 1000)
        .reduce((sum, h) => sum + (h.posted || 0), 0),
    };

    // Connectivity status
    const connectivityStatus = {
      post_errors_last_hour: heartbeats
        .filter(h => Date.now() - new Date(h.snapshot_time).getTime() < 60 * 60 * 1000)
        .reduce((sum, h) => sum + (h.post_errors || 0), 0),
      non_2xx_last_hour: heartbeats
        .filter(h => Date.now() - new Date(h.snapshot_time).getTime() < 60 * 60 * 1000)
        .reduce((sum, h) => sum + (h.post_non_2xx || 0), 0),
      issues: [],
    };

    if (connectivityStatus.post_errors_last_hour > 0) {
      connectivityStatus.issues.push(`${connectivityStatus.post_errors_last_hour} POST fetch errors detected`);
    }
    if (connectivityStatus.non_2xx_last_hour > 0) {
      connectivityStatus.issues.push(`${connectivityStatus.non_2xx_last_hour} non-2xx responses from Base44`);
    }

    // Signal flow status
    const lastSignal = recentSignals?.[0];
    const lastSignalMs = lastSignal ? Date.now() - new Date(lastSignal.received_time).getTime() : null;

    const signalFlowStatus = {
      status: recentSignals.length === 0 ? 'blocked' : recentSignals.length < 5 ? 'degraded' : 'flowing',
      signals_ingested_last_hour: recentSignals.length,
      last_signal_at: lastSignal?.received_time || null,
    };

    // WebSocket book freshness
    const freshBooksStr = latestHeartbeat?.fresh_books || '';
    const venues = freshBooksStr.split(' ');
    let websocketStatus = 'unknown';
    let websocketDetails = 'No recent heartbeat data';

    if (venues.length > 0) {
      // Count venues with fresh data (at least 1 fresh book)
      const freshCount = venues.filter(v => !v.includes('0/')).length;
      const criticalCount = venues.filter(v => v.includes('0/')).length;
      
      // With Binance geo-blocked, we expect OKX + Bybit (4 books). If at least 3 are healthy, it's fine.
      const minimumHealthyVenues = 3;
      websocketStatus = freshCount >= minimumHealthyVenues ? 'healthy' : criticalCount > 0 ? 'critical' : 'degraded';
      websocketDetails = `${freshCount}/${venues.length} venues with fresh data`;
    }

    // Overall health determination
    let overallStatus = 'healthy';
    const issues = [];

    if (heartbeatStatus.status === 'critical') {
      overallStatus = 'critical';
      issues.push('Droplet heartbeat missing or stale (>2 min)');
    } else if (heartbeatStatus.status === 'unknown') {
      overallStatus = 'unknown';
      issues.push('No heartbeat data available');
    }

    if (connectivityStatus.post_errors_last_hour > 5) {
      overallStatus = overallStatus === 'healthy' ? 'warning' : overallStatus;
      issues.push(`High POST error rate (${connectivityStatus.post_errors_last_hour}/hr)`);
    }

    if (signalFlowStatus.status === 'blocked') {
      overallStatus = 'critical';
      issues.push('No signals ingested in the last hour');
    } else if (signalFlowStatus.status === 'degraded') {
      overallStatus = overallStatus === 'healthy' ? 'warning' : overallStatus;
      issues.push(`Low signal flow (${recentSignals.length} signals/hr)`);
    }

    if (websocketStatus === 'critical') {
      overallStatus = 'critical';
      issues.push('WebSocket connectivity severely degraded (multiple venues 0/7)');
    } else if (websocketStatus === 'degraded') {
      overallStatus = overallStatus === 'healthy' ? 'warning' : overallStatus;
      issues.push('Some venues have stale data (expected with Binance geo-block)');
    }

    // Recommendations
    const recommendations = [];

    if (heartbeatStatus.status === 'critical' || heartbeatStatus.status === 'unknown') {
      recommendations.push({
        priority: 'P0',
        action: 'Restart the droplet bot process',
        details: 'SSH to the droplet and run: systemctl restart arb-bot (or manually start node bot.mjs)',
      });
    }

    if (connectivityStatus.post_errors_last_hour > 0) {
      recommendations.push({
        priority: 'P1',
        action: 'Check droplet network connectivity',
        details: 'Verify BASE44_INGEST_URL and BASE44_USER_TOKEN are correctly set in .env',
      });
    }

    if (signalFlowStatus.status === 'blocked') {
      recommendations.push({
        priority: 'P0',
        action: 'Investigate why signals are not flowing',
        details: 'Check bot logs: tail -100 /root/arb-ws-bot/bot.log | grep -E "posted|error"',
      });
    }

    // Latest diagnostics from most recent heartbeat
    const diagnostics = latestHeartbeat
      ? {
          best_edge_bps: latestHeartbeat.best_edge_bps,
          best_edge_pair: latestHeartbeat.best_edge_pair,
          rejected_edge: latestHeartbeat.rejected_edge,
          rejected_fillable: latestHeartbeat.rejected_fillable,
          rejected_stale: latestHeartbeat.rejected_stale,
          venue_pair_checks: latestHeartbeat.venue_pair_checks,
          venue_no_book: latestHeartbeat.venue_no_book,
          venue_stale_book: latestHeartbeat.venue_stale_book,
        }
      : null;

    return Response.json({
      overall_status: overallStatus,
      issues,
      heartbeat: heartbeatStatus,
      connectivity: connectivityStatus,
      signal_flow: signalFlowStatus,
      websocket_books: {
        status: websocketStatus,
        details: websocketDetails,
        venues: freshBooksStr,
      },
      recommendations,
      diagnostics,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('dropletHealth error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});