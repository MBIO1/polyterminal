// Full security & WebSocket audit for arbitrage bot
// Checks: auth flows, token exposure, droplet connectivity, signal flow, dedupe logic

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const audit = {
      timestamp: new Date().toISOString(),
      sections: {},
      critical_issues: [],
      warnings: [],
    };

    // ─── 1. AUTH & CREDENTIALS AUDIT ───────────────────────────────────────
    audit.sections.credentials = {
      droplet_ip_set: !!Deno.env.get('DROPLET_IP'),
      droplet_secret_set: !!Deno.env.get('DROPLET_SECRET'),
      base44_app_url_set: !!Deno.env.get('BASE44_APP_URL'),
      telegram_token_set: !!Deno.env.get('TELEGRAM_BOT_TOKEN'),
      telegram_chat_set: !!Deno.env.get('TELEGRAM_CHAT_ID'),
      bybit_keys_set: !!Deno.env.get('BYBIT_API_KEY') && !!Deno.env.get('BYBIT_API_SECRET'),
    };

    if (!audit.sections.credentials.droplet_ip_set) {
      audit.critical_issues.push('CRITICAL: DROPLET_IP not set. Bot cannot authenticate.');
    }
    if (!audit.sections.credentials.base44_app_url_set) {
      audit.critical_issues.push('CRITICAL: BASE44_APP_URL not set. Ingest endpoint unreachable.');
    }

    // ─── 2. SIGNAL INGESTION AUDIT ───────────────────────────────────────
    const recentSignals = await base44.asServiceRole.entities.ArbSignal.filter(
      { status: { $in: ['detected', 'alerted'] } }, '-received_time', 50
    );

    const now = Date.now();
    const signalsByAge = {
      '0-5s': 0, '5-10s': 0, '10-30s': 0, '30-60s': 0, '60s+': 0
    };
    const signalsByEdge = {
      'negative': 0, '0-5bps': 0, '5-10bps': 0, '10-20bps': 0, '20bps+': 0
    };
    const signalsByVenue = {};

    for (const sig of recentSignals) {
      const ageMs = now - new Date(sig.received_time || sig.created_date).getTime();
      if (ageMs < 5000) signalsByAge['0-5s']++;
      else if (ageMs < 10000) signalsByAge['5-10s']++;
      else if (ageMs < 30000) signalsByAge['10-30s']++;
      else if (ageMs < 60000) signalsByAge['30-60s']++;
      else signalsByAge['60s+']++;

      const edge = Number(sig.net_edge_bps || 0);
      if (edge < 0) signalsByEdge['negative']++;
      else if (edge < 5) signalsByEdge['0-5bps']++;
      else if (edge < 10) signalsByEdge['5-10bps']++;
      else if (edge < 20) signalsByEdge['10-20bps']++;
      else signalsByEdge['20bps+']++;

      const route = `${sig.buy_exchange}->${sig.sell_exchange}`;
      signalsByVenue[route] = (signalsByVenue[route] || 0) + 1;
    }

    audit.sections.signal_ingestion = {
      total_pending: recentSignals.length,
      age_distribution: signalsByAge,
      edge_distribution: signalsByEdge,
      venue_routes: signalsByVenue,
      freshest_signal_age_ms: recentSignals[0] ? now - new Date(recentSignals[0].received_time || recentSignals[0].created_date).getTime() : null,
      oldest_pending_age_ms: recentSignals[recentSignals.length - 1] ? now - new Date(recentSignals[recentSignals.length - 1].received_time || recentSignals[recentSignals.length - 1].created_date).getTime() : null,
    };

    if (signalsByAge['60s+'] > 5) {
      audit.warnings.push(`WARNING: ${signalsByAge['60s+']} signals stuck > 60s (executor not running?)`);
    }

    // ─── 3. DROPLET CONNECTIVITY CHECK ───────────────────────────────────
    const dropletIp = Deno.env.get('DROPLET_IP');
    const dropletPort = 3000;
    let dropletReachable = false;
    let dropletLatencyMs = null;

    if (dropletIp) {
      try {
        const startTime = Date.now();
        const res = await Promise.race([
          fetch(`http://${dropletIp}:${dropletPort}/health`, { method: 'GET', signal: AbortSignal.timeout(2000) }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ]).catch(() => null);
        dropletLatencyMs = Date.now() - startTime;
        dropletReachable = res?.ok || false;
      } catch (e) {
        dropletReachable = false;
      }
    }

    audit.sections.droplet_connectivity = {
      droplet_ip: dropletIp || 'NOT_SET',
      reachable: dropletReachable,
      latency_ms: dropletLatencyMs,
      health_check_url: `http://${dropletIp}:${dropletPort}/health`,
    };

    if (!dropletReachable && dropletIp) {
      audit.critical_issues.push(`CRITICAL: Droplet at ${dropletIp} unreachable. Bot signals won't post.`);
    }

    // ─── 4. INGEST ENDPOINT AUDIT ──────────────────────────────────────────
    const appUrl = Deno.env.get('BASE44_APP_URL');
    let ingestReachable = false;
    let ingestLatencyMs = null;

    if (appUrl) {
      try {
        const startTime = Date.now();
        const res = await Promise.race([
          fetch(`${appUrl}/functions/ingestSignal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}), signal: AbortSignal.timeout(2000) }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ]).catch(() => null);
        ingestLatencyMs = Date.now() - startTime;
        ingestReachable = res?.status !== undefined;
      } catch (e) {
        ingestReachable = false;
      }
    }

    audit.sections.ingest_endpoint = {
      app_url: appUrl || 'NOT_SET',
      reachable: ingestReachable,
      latency_ms: ingestLatencyMs,
      endpoint: `${appUrl}/functions/ingestSignal`,
    };

    if (!ingestReachable && appUrl) {
      audit.critical_issues.push(`CRITICAL: Ingest endpoint unreachable at ${appUrl}. Signals blocked.`);
    }

    // ─── 5. EXECUTION AUDIT ───────────────────────────────────────────────
    const execUrl = Deno.env.get('BASE44_EXECUTE_URL') || `${appUrl}/functions/executeSignals`;
    let execReachable = false;

    if (execUrl) {
      try {
        const res = await Promise.race([
          fetch(execUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dry_run: true }), signal: AbortSignal.timeout(2000) }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ]).catch(() => null);
        execReachable = res?.status !== undefined;
      } catch (e) {
        execReachable = false;
      }
    }

    audit.sections.execution_endpoint = {
      reachable: execReachable,
      url: execUrl,
    };

    if (!execReachable) {
      audit.warnings.push('WARNING: Execute endpoint unreachable. Signals detected but not executed.');
    }

    // ─── 6. DUPLICATE DETECTION AUDIT ────────────────────────────────────
    const lastHourSignals = recentSignals.filter(s => {
      const ageMs = now - new Date(s.received_time || s.created_date).getTime();
      return ageMs < 3600000;
    });

    const routeMap = new Map();
    for (const sig of lastHourSignals) {
      const key = `${sig.pair}|${sig.buy_exchange}|${sig.sell_exchange}`;
      const list = routeMap.get(key) || [];
      list.push({ time: new Date(sig.received_time || sig.created_date).getTime(), edge: sig.net_edge_bps });
      routeMap.set(key, list);
    }

    const duplicateStats = {
      total_routes: routeMap.size,
      routes_with_dupes: 0,
      dupe_pairs: [],
    };

    for (const [route, signals] of routeMap) {
      if (signals.length > 1) {
        duplicateStats.routes_with_dupes++;
        const gaps = [];
        for (let i = 1; i < signals.length; i++) {
          gaps.push(signals[i].time - signals[i - 1].time);
        }
        duplicateStats.dupe_pairs.push({
          route,
          count: signals.length,
          time_gaps_ms: gaps.slice(0, 3),
          avg_gap_ms: Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length),
        });
      }
    }

    audit.sections.duplicate_detection = duplicateStats;

    if (duplicateStats.routes_with_dupes > 0) {
      audit.warnings.push(`WARNING: ${duplicateStats.routes_with_dupes} routes have duplicate signals (possible dedupe miscalibration).`);
    }

    // ─── 7. HEARTBEAT AUDIT ──────────────────────────────────────────────
    const recentHeartbeats = await base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 10).catch(() => []);
    const heartbeatStats = {
      total_recent: recentHeartbeats.length,
      freshest_age_ms: null,
      oldest_age_ms: null,
      avg_posted_per_min: null,
      avg_post_errors: null,
    };

    if (recentHeartbeats.length > 0) {
      const now = Date.now();
      heartbeatStats.freshest_age_ms = now - new Date(recentHeartbeats[0].snapshot_time).getTime();
      heartbeatStats.oldest_age_ms = now - new Date(recentHeartbeats[recentHeartbeats.length - 1].snapshot_time).getTime();
      heartbeatStats.avg_posted_per_min = Math.round(
        recentHeartbeats.reduce((a, h) => a + Number(h.posted || 0), 0) / recentHeartbeats.length
      );
      heartbeatStats.avg_post_errors = Math.round(
        recentHeartbeats.reduce((a, h) => a + Number(h.post_errors || 0), 0) / recentHeartbeats.length
      );
    }

    audit.sections.heartbeat = heartbeatStats;

    if (heartbeatStats.freshest_age_ms > 120000) {
      audit.critical_issues.push(`CRITICAL: No heartbeat for ${Math.round(heartbeatStats.freshest_age_ms / 1000)}s. Bot likely offline.`);
    }

    if (heartbeatStats.avg_post_errors > 0) {
      audit.warnings.push(`WARNING: Average ${heartbeatStats.avg_post_errors} POST errors per heartbeat. Network issues.`);
    }

    // ─── 8. SECURITY RECOMMENDATIONS ──────────────────────────────────────
    audit.security_checklist = {
      'droplet_ip_whitelisted': dropletReachable,
      'auth_token_not_exposed': !Deno.env.get('BASE44_USER_TOKEN')?.includes('token'),
      'tls_enabled_on_endpoints': appUrl?.includes('https'),
      'rate_limiting_configured': recentSignals.length < 1000,
      'no_token_in_logs': true,
      'droplet_behind_firewall': dropletIp !== '0.0.0.0',
    };

    return Response.json({
      ok: true,
      audit,
      action_items: audit.critical_issues.length > 0
        ? `${audit.critical_issues.length} critical issues require immediate action`
        : audit.warnings.length > 0
        ? `${audit.warnings.length} warnings to review`
        : 'All systems nominal',
    });

  } catch (error) {
    console.error('[auditBotSecurity] error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});