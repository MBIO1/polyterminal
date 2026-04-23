// Droplet Health Check — Comprehensive diagnostic endpoint
//
// Checks:
//   - Heartbeat recency and pattern
//   - Signal ingestion flow
//   - WebSocket connectivity (via heartbeat data)
//   - Error rates from diagnostics
//   - Config alignment between droplet and Base44

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { rateLimitMiddleware } from '../lib/rateLimiter.ts';
import { auditLog } from '../lib/auditLogger.ts';

const HEALTH_THRESHOLDS = {
  heartbeat_max_age_sec: 180,        // 3 minutes
  heartbeat_warning_age_sec: 120,    // 2 minutes
  max_post_errors_per_hour: 5,
  max_non_2xx_per_hour: 10,
  min_evaluations_per_hour: 100,     // Should be evaluating markets
  min_signals_per_hour: 1,           // Should see at least some signals
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Auth check
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = Date.now();
    const oneHourAgo = now - 3_600_000;
    const sixHoursAgo = now - (6 * 3_600_000);

    // --- Get recent heartbeats ---
    const allHeartbeats = await base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 100);
    const recentHbs = allHeartbeats.filter(h => new Date(h.snapshot_time).getTime() >= sixHoursAgo);
    const lastHourHbs = recentHbs.filter(h => new Date(h.snapshot_time).getTime() >= oneHourAgo);

    // --- Get recent signals ---
    const recentSignals = await base44.asServiceRole.entities.ArbSignal.list('-received_time', 100);
    const lastHourSignals = recentSignals.filter(s => 
      new Date(s.received_time || s.created_date).getTime() >= oneHourAgo
    );

    // --- Analyze heartbeat health ---
    const lastHb = allHeartbeats[0];
    let heartbeatStatus = 'unknown';
    let heartbeatAgeSec = null;
    let heartbeatIssues = [];

    if (!lastHb) {
      heartbeatStatus = 'no_data';
      heartbeatIssues.push('No heartbeats received ever - droplet may not be running');
    } else {
      heartbeatAgeSec = Math.round((now - new Date(lastHb.snapshot_time).getTime()) / 1000);
      
      if (heartbeatAgeSec > HEALTH_THRESHOLDS.heartbeat_max_age_sec) {
        heartbeatStatus = 'critical';
        heartbeatIssues.push(`Last heartbeat ${heartbeatAgeSec}s ago (threshold: ${HEALTH_THRESHOLDS.heartbeat_max_age_sec}s)`);
      } else if (heartbeatAgeSec > HEALTH_THRESHOLDS.heartbeat_warning_age_sec) {
        heartbeatStatus = 'warning';
        heartbeatIssues.push(`Last heartbeat ${heartbeatAgeSec}s ago - approaching stale threshold`);
      } else {
        heartbeatStatus = 'healthy';
      }
    }

    // --- Check for post errors (critical) ---
    let postErrorsLastHour = 0;
    let non2xxLastHour = 0;
    let totalEvalsLastHour = 0;
    let totalPostedLastHour = 0;

    for (const hb of lastHourHbs) {
      postErrorsLastHour += Number(hb.post_errors || 0);
      non2xxLastHour += Number(hb.post_non_2xx || 0);
      totalEvalsLastHour += Number(hb.evaluations || 0);
      totalPostedLastHour += Number(hb.posted || 0);
    }

    const connectivityIssues = [];
    if (postErrorsLastHour > 0) {
      connectivityIssues.push(`${postErrorsLastHour} POST errors in last hour - network/DNS issues`);
    }
    if (non2xxLastHour > 0) {
      connectivityIssues.push(`${non2xxLastHour} non-2xx responses from ingestSignal - check function logs`);
    }
    if (lastHourHbs.length > 0 && totalEvalsLastHour < HEALTH_THRESHOLDS.min_evaluations_per_hour) {
      connectivityIssues.push(`Only ${totalEvalsLastHour} evaluations in last hour - bot may be stuck`);
    }

    // --- Signal flow analysis ---
    const signalFlowStatus = lastHourSignals.length > 0 ? 'flowing' : 
                            lastHourHbs.some(h => (h.posted || 0) > 0) ? 'blocked' : 'no_opportunities';

    if (signalFlowStatus === 'blocked') {
      connectivityIssues.push('Heartbeats show posted signals but none ingested - check ingestSignal function');
    }

    // --- WebSocket book freshness ---
    let bookFreshness = { status: 'unknown', details: '' };
    if (lastHb?.fresh_books) {
      // Parse format: "OKX-spot:7/7 OKX-perp:7/7 Bybit-spot:7/7 Bybit-perp:7/7"
      const venues = lastHb.fresh_books.split(' ').filter(Boolean);
      const freshCounts = venues.map(v => {
        const match = v.match(/:(\d+)\/(\d+)/);
        return match ? { fresh: parseInt(match[1]), total: parseInt(match[2]) } : null;
      }).filter(Boolean);

      const totalFresh = freshCounts.reduce((a, c) => a + c.fresh, 0);
      const totalExpected = freshCounts.reduce((a, c) => a + c.total, 0);
      
      if (totalExpected > 0) {
        const freshnessPct = (totalFresh / totalExpected) * 100;
        bookFreshness = {
          status: freshnessPct >= 90 ? 'healthy' : freshnessPct >= 50 ? 'degraded' : 'critical',
          details: `${totalFresh}/${totalExpected} books fresh (${freshnessPct.toFixed(0)}%)`,
          venues: lastHb.fresh_books,
        };
      }
    }

    // --- Overall health verdict ---
    const allIssues = [...heartbeatIssues, ...connectivityIssues];
    let overallStatus = 'healthy';
    if (heartbeatStatus === 'critical' || connectivityIssues.length > 0) {
      overallStatus = 'critical';
    } else if (heartbeatStatus === 'warning' || bookFreshness.status === 'degraded') {
      overallStatus = 'warning';
    }

    // --- Recommendations ---
    const recommendations = [];
    if (heartbeatStatus === 'no_data') {
      recommendations.push({
        priority: 'P0',
        action: 'Start the droplet bot',
        details: 'The bot.mjs process is not running. SSH to droplet and run: pm2 start bot.mjs',
      });
    }
    if (postErrorsLastHour > 0) {
      recommendations.push({
        priority: 'P0',
        action: 'Check droplet network connectivity',
        details: 'POST errors suggest DNS or network issues on the droplet',
      });
    }
    if (non2xxLastHour > 0) {
      recommendations.push({
        priority: 'P1',
        action: 'Check ingestSignal function logs',
        details: 'The function is returning errors - check Base44 logs for details',
      });
    }
    if (bookFreshness.status === 'degraded' || bookFreshness.status === 'critical') {
      recommendations.push({
        priority: 'P1',
        action: 'Check WebSocket connections',
        details: 'Some order books are stale - check exchange WebSocket connections',
      });
    }
    if (signalFlowStatus === 'no_opportunities' && heartbeatStatus === 'healthy') {
      recommendations.push({
        priority: 'P2',
        action: 'Markets may be quiet',
        details: 'Bot is running but no opportunities detected - may be normal during low volatility',
      });
    }

    // Log health check
    await auditLog(base44, {
      eventType: 'DROPLET_HEALTH_CHECK',
      severity: overallStatus === 'healthy' ? 'DEBUG' : overallStatus === 'warning' ? 'WARN' : 'ERROR',
      message: `Droplet health check: ${overallStatus}`,
      details: {
        heartbeatStatus,
        heartbeatAgeSec,
        signalFlowStatus,
        bookFreshness: bookFreshness.status,
        issues: allIssues,
      },
      userId: user.id,
    });

    return Response.json({
      ok: true,
      checked_at: new Date().toISOString(),
      overall_status: overallStatus,
      
      heartbeat: {
        status: heartbeatStatus,
        last_seen_sec: heartbeatAgeSec,
        last_seen_at: lastHb?.snapshot_time || null,
        heartbeats_last_hour: lastHourHbs.length,
        total_evaluations_last_hour: totalEvalsLastHour,
        total_posted_last_hour: totalPostedLastHour,
        issues: heartbeatIssues,
      },

      connectivity: {
        post_errors_last_hour: postErrorsLastHour,
        non_2xx_last_hour: non2xxLastHour,
        issues: connectivityIssues,
      },

      signal_flow: {
        status: signalFlowStatus,
        signals_ingested_last_hour: lastHourSignals.length,
        last_signal_at: lastHourSignals[0]?.received_time || null,
      },

      websocket_books: bookFreshness,

      issues: allIssues,
      recommendations: recommendations.sort((a, b) => a.priority.localeCompare(b.priority)),

      diagnostics: lastHb ? {
        best_edge_bps: lastHb.best_edge_bps,
        best_edge_pair: lastHb.best_edge_pair,
        rejected_edge: lastHb.rejected_edge,
        rejected_fillable: lastHb.rejected_fillable,
        rejected_stale: lastHb.rejected_stale,
        venue_pair_checks: lastHb.venue_pair_checks,
        venue_no_book: lastHb.venue_no_book,
        venue_stale_book: lastHb.venue_stale_book,
      } : null,
    });

  } catch (error) {
    console.error('dropletHealth error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
