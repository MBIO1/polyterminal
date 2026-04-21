// Returns per-pair signal stats for the adaptive-threshold feedback loop.
// Call with { pair: "BTC-USDT", window_hours: 24 } or omit pair for all.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const windowHours = Number(body.window_hours) || 24;
    const cutoff = new Date(Date.now() - windowHours * 3600_000).toISOString();

    const all = await base44.asServiceRole.entities.ArbSignal.list('-received_time', 2000);
    const recent = all.filter(s => (s.received_time || s.created_date) >= cutoff);
    const pairs = body.pair ? [body.pair] : Array.from(new Set(recent.map(s => s.pair)));

    const stats = pairs.map(pair => {
      const rows = recent.filter(s => s.pair === pair);
      const executed = rows.filter(s => s.status === 'executed' && typeof s.executed_pnl_bps === 'number');
      const wins = executed.filter(s => s.executed_pnl_bps > 0);
      const winRate = executed.length ? wins.length / executed.length : null;
      const avgEdge = rows.length ? rows.reduce((a, s) => a + (s.net_edge_bps || 0), 0) / rows.length : 0;
      const avgRealized = executed.length ? executed.reduce((a, s) => a + (s.executed_pnl_bps || 0), 0) / executed.length : null;
      const avgSlippageBps = executed.length
        ? executed.reduce((a, s) => a + ((s.net_edge_bps || 0) - (s.executed_pnl_bps || 0)), 0) / executed.length
        : null;

      // Recommend threshold: if win rate < 60%, bump floor by 1 bp of avg slippage
      let recommendedMinBps = null;
      if (winRate !== null && winRate < 0.6 && avgSlippageBps !== null) {
        recommendedMinBps = Math.max(2, Math.round(avgEdge + Math.abs(avgSlippageBps)));
      }

      return {
        pair,
        total_signals: rows.length,
        executed: executed.length,
        wins: wins.length,
        win_rate: winRate,
        avg_signal_edge_bps: Number(avgEdge.toFixed(2)),
        avg_realized_bps: avgRealized !== null ? Number(avgRealized.toFixed(2)) : null,
        avg_slippage_bps: avgSlippageBps !== null ? Number(avgSlippageBps.toFixed(2)) : null,
        recommended_min_bps: recommendedMinBps,
      };
    }).sort((a, b) => b.total_signals - a.total_signals);

    return Response.json({ ok: true, window_hours: windowHours, pairs: stats });
  } catch (error) {
    console.error('signalStats error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});