import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try {
      user = await base44.auth.me();
    } catch (authError) {
      console.warn('dropletHealth: auth check failed');
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

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

    // Always fetch the latest heartbeat regardless of age (so we can show "X hours ago")
    const latestHeartbeatList = await base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 1);
    const latestHeartbeat = latestHeartbeatList?.[0];

    // Fetch heartbeats from the last hour for rate calculations
    const heartbeats = await base44.asServiceRole.entities.ArbHeartbeat.filter(
      { snapshot_time: { $gte: oneHourAgo } },
      '-snapshot_time',
      500
    );

    // Fetch recent signals (last hour for rates, last 5 min for "is it working NOW")
    const recentSignals = await base44.asServiceRole.entities.ArbSignal.filter(
      { received_time: { $gte: oneHourAgo } },
      '-received_time'
    );
    const fiveMinAgoMs = now - 5 * 60 * 1000;
    const signalsLast5Min = recentSignals.filter(s => {
      const t = new Date(s.received_time || s.created_date || 0).getTime();
      return Number.isFinite(t) && t >= fiveMinAgoMs;
    }).length;
    // Auth is healthy NOW if either: recent signals are landing, OR no recent rejections in the last 10 min.
    const authIsHealthyNow = signalsLast5Min > 0 || recentNon2xx === 0;

    // === HEARTBEAT STATUS ===
    const lastHeartbeatMs = latestHeartbeat
      ? now - new Date(latestHeartbeat.snapshot_time).getTime()
      : null;

    const totalEvals = heartbeats.reduce((s, h) => s + (h.evaluations || 0), 0);
    const totalPosted = heartbeats.reduce((s, h) => s + (h.posted || 0), 0);
    const totalPostAttempts = heartbeats.reduce((s, h) => s + (h.post_attempts || 0), 0);
    const totalPostErrors = heartbeats.reduce((s, h) => s + (h.post_errors || 0), 0);
    const totalNon2xx = heartbeats.reduce((s, h) => s + (h.post_non_2xx || 0), 0);

    // RECENT-window stats (last 10 min) — used to determine if auth is CURRENTLY broken.
    // Avoids stale 1-hour rejections triggering critical status long after a fix.
    const tenMinAgoMs = now - 10 * 60 * 1000;
    const recentHeartbeats = heartbeats.filter(h => {
      const t = new Date(h.snapshot_time || 0).getTime();
      return Number.isFinite(t) && t >= tenMinAgoMs;
    });
    const recentPosted = recentHeartbeats.reduce((s, h) => s + (h.posted || 0), 0);
    const recentNon2xx = recentHeartbeats.reduce((s, h) => s + (h.post_non_2xx || 0), 0);
    const recentPostErrors = recentHeartbeats.reduce((s, h) => s + (h.post_errors || 0), 0);

    const heartbeatStatus = {
      status: lastHeartbeatMs === null ? 'unknown' : lastHeartbeatMs < 120_000 ? 'healthy' : 'critical',
      last_seen_sec: lastHeartbeatMs ? Math.floor(lastHeartbeatMs / 1000) : null,
      heartbeats_last_hour: heartbeats.length,
      total_evaluations_last_hour: totalEvals,
      total_posted_last_hour: totalPosted,
    };

    // === CONNECTIVITY STATUS ===
    // Calculate ingest success rate: posted - non2xx errors = actually accepted
    const acceptedSignals = recentSignals.length;
    const ingestSuccessRate = totalPosted > 0 ? (acceptedSignals / totalPosted) * 100 : null;

    const connectivityStatus = {
      post_attempts_last_hour: totalPostAttempts,
      post_errors_last_hour: totalPostErrors,
      non_2xx_last_hour: totalNon2xx,
      signals_accepted_last_hour: acceptedSignals,
      ingest_success_rate_pct: ingestSuccessRate !== null ? Math.round(ingestSuccessRate) : null,
      issues: [],
    };

    if (recentPostErrors > 0) {
      connectivityStatus.issues.push(`${recentPostErrors} POST network errors (last 10 min)`);
    }
    if (recentNon2xx > 0) {
      const rejectionRate = recentPosted > 0 ? Math.round((recentNon2xx / recentPosted) * 100) : 0;
      connectivityStatus.issues.push(
        `${recentNon2xx}/${recentPosted} signals rejected by Base44 in last 10 min (${rejectionRate}%) — likely BOT_SECRET mismatch`
      );
    }

    // === SIGNAL FLOW STATUS ===
    // "blocked" = bot posting BUT nothing accepted = auth problem
    // "no_opportunities" = bot evaluating BUT nothing posted = market quiet
    // "flowing" = signals accepted
    const lastSignal = recentSignals?.[0];
    let signalFlowStatusLabel;
    if (totalEvals === 0 && heartbeats.length === 0) {
      signalFlowStatusLabel = 'no_heartbeat';
    } else if (totalPosted === 0) {
      signalFlowStatusLabel = 'no_opportunities'; // bot scanning, market quiet
    } else if (acceptedSignals === 0) {
      signalFlowStatusLabel = 'blocked'; // bot posting but all rejected
    } else if (acceptedSignals < 3) {
      signalFlowStatusLabel = 'degraded';
    } else {
      signalFlowStatusLabel = 'flowing';
    }

    const signalFlowStatus = {
      status: signalFlowStatusLabel,
      signals_ingested_last_hour: acceptedSignals,
      signals_posted_by_bot_last_hour: totalPosted,
      last_signal_at: lastSignal?.received_time || null,
    };

    // === WEBSOCKET BOOK STATUS ===
    const freshBooksStr = latestHeartbeat?.fresh_books || '';
    const venues = freshBooksStr.split(' ').filter(Boolean);
    let websocketStatus = 'unknown';
    let websocketDetails = 'No recent heartbeat data';

    if (venues.length > 0) {
      const freshCount = venues.filter(v => !v.includes(':0/')).length;
      const criticalCount = venues.filter(v => v.includes(':0/')).length;
      websocketStatus = freshCount >= 3 ? 'healthy' : criticalCount > 0 ? 'critical' : 'degraded';
      websocketDetails = `${freshCount}/${venues.length} venues with fresh data`;
    }

    // === OVERALL STATUS ===
    let overallStatus = 'healthy';
    const issues = [];

    if (heartbeatStatus.status === 'critical') {
      overallStatus = 'critical';
      issues.push('Droplet heartbeat missing or stale (>2 min)');
    } else if (heartbeatStatus.status === 'unknown') {
      overallStatus = 'unknown';
      issues.push('No heartbeat data available');
    }

    // CRITICAL: use 10-min recent window — stale 1-hour rejections shouldn't keep flagging critical.
    if (recentNon2xx > 2) {
      overallStatus = 'critical';
      issues.push(`Base44 rejecting signals (${recentNon2xx} non-2xx in last 10 min) — auth/secret issue`);
    } else if (recentPostErrors > 2) {
      overallStatus = overallStatus === 'healthy' ? 'warning' : overallStatus;
      issues.push(`High POST error rate (${recentPostErrors} in last 10 min)`);
    }

    if (signalFlowStatusLabel === 'blocked') {
      overallStatus = 'critical';
      issues.push('Bot posting signals but ALL rejected by Base44 (auth failure)');
    } else if (signalFlowStatusLabel === 'no_opportunities') {
      // not an error — market is just quiet
      if (overallStatus === 'healthy') {
        issues.push('No tradeable spreads in market right now (bot is scanning normally)');
      }
    } else if (signalFlowStatusLabel === 'degraded') {
      overallStatus = overallStatus === 'healthy' ? 'warning' : overallStatus;
      issues.push(`Low signal flow (${acceptedSignals} accepted/hr)`);
    }

    if (websocketStatus === 'critical') {
      overallStatus = 'critical';
      issues.push('WebSocket connectivity severely degraded');
    } else if (websocketStatus === 'degraded') {
      overallStatus = overallStatus === 'healthy' ? 'warning' : overallStatus;
      issues.push('Some venues have stale data');
    }

    // === RECOMMENDATIONS ===
    const recommendations = [];

    if (heartbeatStatus.status === 'critical' || heartbeatStatus.status === 'unknown') {
      recommendations.push({
        priority: 'P0',
        action: 'Restart the droplet bot process',
        details: 'SSH to droplet: pm2 restart arb-bot && pm2 logs arb-bot --lines 30',
      });
    }

    if (recentNon2xx > 2) {
      recommendations.push({
        priority: 'P0',
        action: 'BOT_SECRET on droplet does not match Base44',
        details: 'Run "Fix Env Now" button to regenerate .env with correct BOT_SECRET, then restart PM2',
      });
    }

    if (recentPostErrors > 2) {
      recommendations.push({
        priority: 'P1',
        action: 'Network connectivity issues from droplet to Base44',
        details: 'Check droplet internet, DNS, firewall. Try: curl -I https://app.base44.com',
      });
    }

    // === DIAGNOSTICS ===
    const diagnostics = latestHeartbeat
      ? {
          best_edge_bps: latestHeartbeat.best_edge_bps,
          best_edge_pair: latestHeartbeat.best_edge_pair,
          best_edge_route: latestHeartbeat.best_edge_route,
          rejected_edge: latestHeartbeat.rejected_edge,
          rejected_fillable: latestHeartbeat.rejected_fillable,
          rejected_stale: latestHeartbeat.rejected_stale,
          rejected_dedupe: latestHeartbeat.rejected_dedupe,
          venue_pair_checks: latestHeartbeat.venue_pair_checks,
          venue_no_book: latestHeartbeat.venue_no_book,
          venue_stale_book: latestHeartbeat.venue_stale_book,
          bucket_distribution: {
            '0-5_bps': latestHeartbeat.bucket_0_5,
            '5-10_bps': latestHeartbeat.bucket_5_10,
            '10-15_bps': latestHeartbeat.bucket_10_15,
            '15-20_bps': latestHeartbeat.bucket_15_20,
            '20+_bps': latestHeartbeat.bucket_20_plus,
          },
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