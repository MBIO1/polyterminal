// Receives minute-level heartbeats from the droplet bot and stores them as ArbHeartbeat rows.
// Enables "bot productivity" analysis: what did the market offer, was our floor correct,
// what would a lower floor have earned on paper?
//
// Authenticated same as ingestSignal: droplet posts with Bearer user token.
//
// POST body (all optional except snapshot_time):
// {
//   snapshot_time: "2026-04-22T19:00:00.000Z",
//   evaluations: 9026, posted: 0, rejected_edge: 14624, rejected_fillable: 0,
//   rejected_stale: 0, rejected_dedupe: 0,
//   best_edge_bps: 4.2, best_edge_pair: "DOGE-USDT", best_edge_route: "Bybit-perp->Bybit-spot",
//   bucket_0_5: 9000, bucket_5_10: 25, bucket_10_15: 1, bucket_15_20: 0, bucket_20_plus: 0,
//   fresh_books: "OKX-spot:7/7 OKX-perp:7/7 Bybit-spot:7/7 Bybit-perp:7/7",
//   min_edge_floor_bps: 20
// }

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'POST only' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const now = new Date().toISOString();

    const heartbeat = await base44.asServiceRole.entities.ArbHeartbeat.create({
      snapshot_time: body.snapshot_time || now,
      received_time: now,
      evaluations: Number(body.evaluations) || 0,
      posted: Number(body.posted) || 0,
      rejected_edge: Number(body.rejected_edge) || 0,
      rejected_fillable: Number(body.rejected_fillable) || 0,
      rejected_stale: Number(body.rejected_stale) || 0,
      rejected_dedupe: Number(body.rejected_dedupe) || 0,
      best_edge_bps: Number(body.best_edge_bps) || 0,
      best_edge_pair: body.best_edge_pair || '',
      best_edge_route: body.best_edge_route || '',
      bucket_0_5: Number(body.bucket_0_5) || 0,
      bucket_5_10: Number(body.bucket_5_10) || 0,
      bucket_10_15: Number(body.bucket_10_15) || 0,
      bucket_15_20: Number(body.bucket_15_20) || 0,
      bucket_20_plus: Number(body.bucket_20_plus) || 0,
      fresh_books: body.fresh_books || '',
      min_edge_floor_bps: Number(body.min_edge_floor_bps) || 0,
    });

    return Response.json({ ok: true, heartbeat_id: heartbeat.id });
  } catch (error) {
    console.error('ingestHeartbeat error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});