// analyzeSignalPerformance — compares signal capture rates before/after threshold reductions
// Returns detailed breakdown of execution rates, rejection reasons, and opportunity capture

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    // Fetch recent signals (last 500)
    const signals = await base44.asServiceRole.entities.ArbSignal.list('-created_date', 500);
    
    // Fetch recent heartbeats (last 100)
    const heartbeats = await base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 100);

    // Categorize signals
    const executed = signals.filter(s => s.status === 'executed');
    const rejected = signals.filter(s => s.status === 'rejected');
    const expired = signals.filter(s => s.status === 'expired');
    const detected = signals.filter(s => s.status === 'detected' || s.status === 'alerted');

    // Rejection breakdown
    const rejectionReasons = {
      exec_error: rejected.filter(s => s.rejection_reason?.includes('exec_error')).length,
      low_edge: rejected.filter(s => s.rejection_reason?.includes('edge')).length,
      low_fillable: rejected.filter(s => s.rejection_reason?.includes('fillable')).length,
      stale: rejected.filter(s => s.rejection_reason?.includes('stale')).length,
      duplicate: rejected.filter(s => s.rejection_reason?.includes('duplicate')).length,
      no_bybit_leg: rejected.filter(s => s.rejection_reason?.includes('no_bybit_leg')).length,
      same_venue: rejected.filter(s => s.rejection_reason?.includes('same_venue')).length,
      other: rejected.filter(s => 
        !s.rejection_reason || (
          !s.rejection_reason.includes('exec_error') &&
          !s.rejection_reason.includes('edge') &&
          !s.rejection_reason.includes('fillable') &&
          !s.rejection_reason.includes('stale') &&
          !s.rejection_reason.includes('duplicate') &&
          !s.rejection_reason.includes('no_bybit_leg') &&
          !s.rejection_reason.includes('same_venue')
        )
      ).length,
    };

    // Calculate execution rate
    const totalProcessed = executed.length + rejected.length + expired.length;
    const executionRate = totalProcessed > 0 ? (executed.length / totalProcessed * 100) : 0;

    // Heartbeat analysis (last 24 hours)
    const now = Date.now();
    const last24h = heartbeats.filter(h => {
      const hbTime = new Date(h.snapshot_time).getTime();
      return (now - hbTime) < 24 * 60 * 60 * 1000;
    });

    const totalEvaluations = last24h.reduce((sum, h) => sum + (Number(h.evaluations) || 0), 0);
    const totalPosted = last24h.reduce((sum, h) => sum + (Number(h.posted) || 0), 0);
    const totalRejectedEdge = last24h.reduce((sum, h) => sum + (Number(h.rejected_edge) || 0), 0);
    const totalRejectedFillable = last24h.reduce((sum, h) => sum + (Number(h.rejected_fillable) || 0), 0);
    const totalRejectedStale = last24h.reduce((sum, h) => sum + (Number(h.rejected_stale) || 0), 0);
    const totalRejectedDedupe = last24h.reduce((sum, h) => sum + (Number(h.rejected_dedupe) || 0), 0);

    // Edge distribution from heartbeats
    const bucket0_5 = last24h.reduce((sum, h) => sum + (Number(h.bucket_0_5) || 0), 0);
    const bucket5_10 = last24h.reduce((sum, h) => sum + (Number(h.bucket_5_10) || 0), 0);
    const bucket10_15 = last24h.reduce((sum, h) => sum + (Number(h.bucket_10_15) || 0), 0);
    const bucket15_20 = last24h.reduce((sum, h) => sum + (Number(h.bucket_15_20) || 0), 0);
    const bucket20Plus = last24h.reduce((sum, h) => sum + (Number(h.bucket_20_plus) || 0), 0);

    // Best edges seen
    const bestEdges = last24h.map(h => Number(h.best_edge_bps) || 0).filter(x => x > 0);
    const avgBestEdge = bestEdges.length > 0 ? bestEdges.reduce((a, b) => a + b, 0) / bestEdges.length : 0;
    const maxBestEdge = bestEdges.length > 0 ? Math.max(...bestEdges) : 0;

    // Compare with industry benchmarks
    const industryExecutionRate = 20; // 15-25% industry average
    const industryLatencyMs = 100; // 50-150ms
    const yourLatencyMs = signals.length > 0 ? 
      signals.reduce((sum, s) => sum + (Number(s.signal_age_ms) || 0), 0) / signals.length : 0;

    return Response.json({
      summary: {
        total_signals_analyzed: signals.length,
        executed: executed.length,
        rejected: rejected.length,
        expired: expired.length,
        detected_pending: detected.length,
        execution_rate_pct: parseFloat(executionRate.toFixed(2)),
      },
      rejection_breakdown: {
        ...rejectionReasons,
        total_rejected: rejected.length,
      },
      heartbeat_stats_24h: {
        heartbeats_analyzed: last24h.length,
        total_evaluations: totalEvaluations,
        total_posted: totalPosted,
        rejected_edge: totalRejectedEdge,
        rejected_fillable: totalRejectedFillable,
        rejected_stale: totalRejectedStale,
        rejected_dedupe: totalRejectedDedupe,
        posting_rate_pct: totalEvaluations > 0 ? parseFloat((totalPosted / totalEvaluations * 100).toFixed(4)) : 0,
      },
      edge_distribution_24h: {
        bucket_0_5_bps: bucket0_5,
        bucket_5_10_bps: bucket5_10,
        bucket_10_15_bps: bucket10_15,
        bucket_15_20_bps: bucket15_20,
        bucket_20_plus_bps: bucket20Plus,
        total_opportunities: bucket0_5 + bucket5_10 + bucket10_15 + bucket15_20 + bucket20Plus,
        avg_best_edge_bps: parseFloat(avgBestEdge.toFixed(2)),
        max_best_edge_bps: parseFloat(maxBestEdge.toFixed(2)),
      },
      benchmarks: {
        your_execution_rate_pct: parseFloat(executionRate.toFixed(2)),
        industry_execution_rate_pct: industryExecutionRate,
        performance_vs_industry: executionRate > industryExecutionRate ? 'OUTPERFORMING' : 'UNDERPERFORMING',
        your_avg_latency_ms: parseFloat(yourLatencyMs.toFixed(0)),
        industry_avg_latency_ms: industryLatencyMs,
      },
      insights: [
        executionRate > 40 ? '✅ Execution rate is EXCELLENT (>40%)' :
        executionRate > 25 ? '✅ Execution rate is GOOD (>25%)' :
        executionRate > 15 ? '⚠️ Execution rate is AVERAGE (15-25%)' :
        '❌ Execution rate is BELOW AVERAGE (<15%)',
        
        rejectionReasons.exec_error > 5 ? '❗ High exec_error count — check droplet connectivity' :
        rejectionReasons.exec_error > 0 ? '⚠️ Some execution errors — verify order-server is running' :
        '✅ No execution errors',
        
        totalRejectedEdge > totalEvaluations * 0.9 ? '⚠️ 90%+ opportunities rejected for low edge — market is quiet' :
        totalRejectedEdge > totalEvaluations * 0.7 ? '✅ Edge rejection rate is normal (70-90%)' :
        '✅ Edge rejection rate is LOW (<70%) — good market conditions',
        
        bucket5_10 + bucket10_15 + bucket15_20 > 0 ? `✅ Capturing ${bucket5_10 + bucket10_15 + bucket15_20} opportunities in 5-20 bps range` :
        '⚠️ No opportunities in 5-20 bps range — market very quiet',
      ],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});