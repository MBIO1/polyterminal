// Receives minute-level heartbeats from the droplet bot and stores them as ArbHeartbeat rows.
// Accepts auth via: user token OR droplet IP/secret

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function getClientIP(req) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         req.headers.get('cf-connecting-ip') ||
         'unknown';
}

Deno.serve(async (req) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const clientIP = getClientIP(req);

  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'POST only' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);

    // Authentication - allow either logged-in user OR droplet service
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      // Not authenticated, check if it's an authorized droplet
    }

    const isDroplet = clientIP === Deno.env.get('DROPLET_IP') ||
                      req.headers.get('x-droplet-auth') === Deno.env.get('DROPLET_API_KEY');

    if (!user && !isDroplet) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse body
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

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
      best_edge_pair: String(body.best_edge_pair || '').slice(0, 20),
      best_edge_route: String(body.best_edge_route || '').slice(0, 100),
      bucket_0_5: Number(body.bucket_0_5) || 0,
      bucket_5_10: Number(body.bucket_5_10) || 0,
      bucket_10_15: Number(body.bucket_10_15) || 0,
      bucket_15_20: Number(body.bucket_15_20) || 0,
      bucket_20_plus: Number(body.bucket_20_plus) || 0,
      fresh_books: String(body.fresh_books || '').slice(0, 500),
      min_edge_floor_bps: Number(body.min_edge_floor_bps) || 0,
      venue_pair_checks: Number(body.venue_pair_checks) || 0,
      venue_no_book: Number(body.venue_no_book) || 0,
      venue_stale_book: Number(body.venue_stale_book) || 0,
      passed_edge_gate: Number(body.passed_edge_gate) || 0,
      passed_fillable_gate: Number(body.passed_fillable_gate) || 0,
      passed_stale_gate: Number(body.passed_stale_gate) || 0,
      passed_dedupe_gate: Number(body.passed_dedupe_gate) || 0,
      post_attempts: Number(body.post_attempts) || 0,
      post_errors: Number(body.post_errors) || 0,
      post_non_2xx: Number(body.post_non_2xx) || 0,
    });

    console.log(`[ingestHeartbeat] accepted from ${isDroplet ? 'droplet' : 'user'} (${clientIP})`);

    return Response.json({ ok: true, heartbeat_id: heartbeat.id });

  } catch (error) {
    console.error('[ingestHeartbeat] error:', error.message);
    return Response.json({ error: error.message, requestId }, { status: 500 });
  }
});