// Unified system audit — single endpoint that rolls up the live state of:
// - Bot config (running flags, paper mode, kill switch)
// - Signal pipeline (detected/alerted/executed/rejected counts, last-hour throughput)
// - Executor outcomes (recent trades with PnL + mode)
// - Open positions and net delta drift vs cap
// - Heartbeat freshness (are we still ingesting?)
//
// Read-only, intended for continuous polling from an AuditPanel on the dashboard.
//
// Admin-only.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    // Allow both admin and regular users to view audit (read-only)

    const now = Date.now();
    const oneHourAgo = now - 3_600_000;
    const oneDayAgo = now - 86_400_000;

    // --- Config ---
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config = configs?.[0];
    if (!config) return Response.json({ error: 'No ArbConfig found' }, { status: 400 });

    // --- Signals (recent window) ---
    const recentSignals = await base44.asServiceRole.entities.ArbSignal.list('-received_time', 500);
    const statusCounts = { detected: 0, alerted: 0, executed: 0, rejected: 0, expired: 0 };
    let signalsLastHour = 0;
    let executedLastHour = 0;
    let rejectedLastHour = 0;
    const rejectReasonCounts = {};

    for (const s of recentSignals) {
      statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
      const t = new Date(s.received_time || s.created_date).getTime();
      if (t >= oneHourAgo) {
        signalsLastHour++;
        if (s.status === 'executed') executedLastHour++;
        if (s.status === 'rejected') {
          rejectedLastHour++;
          // rejection_reason can be a single reason like "edge_below_min(...)" or a
          // comma-joined list of top-level reasons. We split only on commas that are NOT
          // inside parentheses to avoid splitting the detail params inside each reason.
          const raw = String(s.rejection_reason || 'unknown');
          const reasons = raw.split(/,(?![^()]*\))/);
          for (const r of reasons) {
            const key = r.trim().split('(')[0].trim() || 'unknown';
            rejectReasonCounts[key] = (rejectReasonCounts[key] || 0) + 1;
          }
        }
      }
    }

    const pending = recentSignals
      .filter(s => s.status === 'detected' || s.status === 'alerted')
      .slice(0, 10)
      .map(s => ({
        id: s.id,
        pair: s.pair,
        net_edge_bps: Number(s.net_edge_bps || 0),
        fillable_size_usd: Number(s.fillable_size_usd || 0),
        age_sec: Math.round((now - new Date(s.received_time || s.created_date).getTime()) / 1000),
        status: s.status,
      }));

    // --- Trades (last 24h) ---
    const recentTrades = await base44.asServiceRole.entities.ArbTrade.list('-updated_date', 100);
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayTrades = recentTrades.filter(t => t.trade_date === todayStr);
    const todayPnl = todayTrades.reduce((a, t) => a + Number(t.net_pnl || 0), 0);
    const last10Trades = recentTrades.slice(0, 10).map(t => ({
      trade_id: t.trade_id,
      asset: t.asset,
      strategy: t.strategy,
      net_pnl: Number(t.net_pnl || 0),
      net_pnl_bps: Number(t.net_pnl_bps || 0),
      mode: t.mode,
      status: t.status,
      ts: t.updated_date || t.entry_timestamp,
    }));
    const openTradeCount = recentTrades.filter(t => t.status === 'Open').length;

    // --- Positions / delta drift ---
    const positions = await base44.asServiceRole.entities.ArbLivePosition.filter(
      { status: 'Open' }, '-snapshot_time', 100,
    );
    const netDelta = positions.reduce((a, p) => a + Number(p.net_delta_usd || 0), 0);
    const marginUsed = positions.reduce((a, p) => a + Number(p.margin_used || 0), 0);
    const totalCap = Number(config.total_capital || 0);
    const driftCap = totalCap * Number(config.max_net_delta_drift_pct || 0.001);
    const perpBucket = totalCap * Number(config.perp_collateral_pct || 0);
    const marginUtil = perpBucket > 0 ? marginUsed / perpBucket : 0;

    // --- Heartbeat freshness ---
    const heartbeats = await base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 1);
    const lastHb = heartbeats[0];
    const lastHbAgeSec = lastHb
      ? Math.round((now - new Date(lastHb.snapshot_time).getTime()) / 1000)
      : null;
    const hbHealthy = lastHbAgeSec != null && lastHbAgeSec < 180; // <3 min

    // --- Top-level verdict ---
    const issues = [];
    if (!config.bot_running) issues.push('bot_not_running');
    if (config.kill_switch_active) issues.push('kill_switch_active');
    if (!hbHealthy) issues.push('heartbeat_stale');
    if (Math.abs(netDelta) > driftCap) issues.push('delta_breach');
    if (marginUtil >= Number(config.max_margin_utilization_pct || 1)) issues.push('margin_breach');

    const verdict = issues.length === 0 ? 'healthy' : issues.length <= 1 ? 'degraded' : 'critical';

    return Response.json({
      ok: true,
      ts: new Date().toISOString(),
      verdict,
      issues,
      config: {
        bot_running: !!config.bot_running,
        paper_trading: config.paper_trading !== false,
        kill_switch_active: !!config.kill_switch_active,
        total_capital: totalCap,
        btc_min_edge_bps: Number(config.btc_min_edge_bps || 0),
        eth_min_edge_bps: Number(config.eth_min_edge_bps || 0),
        min_fillable_usd: Number(config.min_fillable_usd || 0),
      },
      signals: {
        total_recent: recentSignals.length,
        status_counts: statusCounts,
        last_hour: {
          signals: signalsLastHour,
          executed: executedLastHour,
          rejected: rejectedLastHour,
          execution_rate: signalsLastHour ? executedLastHour / signalsLastHour : 0,
        },
        top_reject_reasons: Object.entries(rejectReasonCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([reason, count]) => ({ reason, count })),
        pending,
      },
      trades: {
        today_count: todayTrades.length,
        today_pnl_usd: Number(todayPnl.toFixed(2)),
        open_count: openTradeCount,
        last_10: last10Trades,
      },
      positions: {
        open_count: positions.length,
        net_delta_usd: Number(netDelta.toFixed(2)),
        drift_cap_usd: Number(driftCap.toFixed(2)),
        within_drift: Math.abs(netDelta) <= driftCap,
        margin_used_usd: Number(marginUsed.toFixed(2)),
        margin_util_pct: Number((marginUtil * 100).toFixed(2)),
      },
      heartbeat: {
        last_age_sec: lastHbAgeSec,
        healthy: hbHealthy,
        evaluations: lastHb ? Number(lastHb.evaluations || 0) : 0,
        posted: lastHb ? Number(lastHb.posted || 0) : 0,
        best_edge_bps: lastHb ? Number(lastHb.best_edge_bps || 0) : 0,
        fresh_books: lastHb?.fresh_books || '',
      },
    });
  } catch (error) {
    console.error('systemAudit error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});