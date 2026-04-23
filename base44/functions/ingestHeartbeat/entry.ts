// Receives minute-level heartbeats from the droplet bot and stores them as ArbHeartbeat rows.
// SECURITY ENHANCED VERSION
//
// Security improvements:
//   - Rate limiting
//   - Input validation
//   - Audit logging
//   - Suspicious input detection

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { rateLimitMiddleware, getRateLimitHeaders, getClientIP } from '../lib/rateLimiter.ts';
import { sanitizeNumber, sanitizeString, detectSuspiciousInput } from '../lib/validation.ts';
import { auditLog } from '../lib/auditLogger.ts';

Deno.serve(async (req) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const clientIP = getClientIP(req);

  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'POST only' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);

    // ENHANCED: Rate limiting
    const rateLimitCheck = await rateLimitMiddleware(req, base44, 'ingestHeartbeat', {
      perUser: true,
      perIP: true,
    });

    if (rateLimitCheck.blocked) {
      return rateLimitCheck.response;
    }

    // Authentication
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Parse body
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // ENHANCED: Check for suspicious input
    const suspiciousCheck = detectSuspiciousInput(body);
    if (suspiciousCheck.suspicious) {
      await auditLog(base44, {
        eventType: 'SUSPICIOUS_INPUT_DETECTED',
        severity: 'ERROR',
        message: 'Suspicious input detected in heartbeat',
        details: { issues: suspiciousCheck.issues },
        userId: user.id,
        requestId,
        ipAddress: clientIP,
      });

      return Response.json({ error: 'Invalid input detected' }, { status: 400 });
    }

    const now = new Date().toISOString();

    // ENHANCED: Sanitize all numeric inputs
    const heartbeat = await base44.asServiceRole.entities.ArbHeartbeat.create({
      snapshot_time: body.snapshot_time || now,
      received_time: now,
      evaluations: sanitizeNumber(body.evaluations, { min: 0, max: 10000000, decimals: 0 }) || 0,
      posted: sanitizeNumber(body.posted, { min: 0, max: 10000, decimals: 0 }) || 0,
      rejected_edge: sanitizeNumber(body.rejected_edge, { min: 0, max: 10000000, decimals: 0 }) || 0,
      rejected_fillable: sanitizeNumber(body.rejected_fillable, { min: 0, max: 10000000, decimals: 0 }) || 0,
      rejected_stale: sanitizeNumber(body.rejected_stale, { min: 0, max: 10000000, decimals: 0 }) || 0,
      rejected_dedupe: sanitizeNumber(body.rejected_dedupe, { min: 0, max: 10000000, decimals: 0 }) || 0,
      best_edge_bps: sanitizeNumber(body.best_edge_bps, { min: -10000, max: 10000, decimals: 2 }) || 0,
      best_edge_pair: sanitizeString(body.best_edge_pair || '', 20),
      best_edge_route: sanitizeString(body.best_edge_route || '', 100),
      bucket_0_5: sanitizeNumber(body.bucket_0_5, { min: 0, max: 10000000, decimals: 0 }) || 0,
      bucket_5_10: sanitizeNumber(body.bucket_5_10, { min: 0, max: 10000000, decimals: 0 }) || 0,
      bucket_10_15: sanitizeNumber(body.bucket_10_15, { min: 0, max: 10000000, decimals: 0 }) || 0,
      bucket_15_20: sanitizeNumber(body.bucket_15_20, { min: 0, max: 10000000, decimals: 0 }) || 0,
      bucket_20_plus: sanitizeNumber(body.bucket_20_plus, { min: 0, max: 10000000, decimals: 0 }) || 0,
      fresh_books: sanitizeString(body.fresh_books || '', 500),
      min_edge_floor_bps: sanitizeNumber(body.min_edge_floor_bps, { min: 0, max: 1000, decimals: 2 }) || 0,
      venue_pair_checks: sanitizeNumber(body.venue_pair_checks, { min: 0, max: 1000000, decimals: 0 }) || 0,
      venue_no_book: sanitizeNumber(body.venue_no_book, { min: 0, max: 1000000, decimals: 0 }) || 0,
      venue_stale_book: sanitizeNumber(body.venue_stale_book, { min: 0, max: 1000000, decimals: 0 }) || 0,
      passed_edge_gate: sanitizeNumber(body.passed_edge_gate, { min: 0, max: 1000000, decimals: 0 }) || 0,
      passed_fillable_gate: sanitizeNumber(body.passed_fillable_gate, { min: 0, max: 1000000, decimals: 0 }) || 0,
      passed_stale_gate: sanitizeNumber(body.passed_stale_gate, { min: 0, max: 1000000, decimals: 0 }) || 0,
      passed_dedupe_gate: sanitizeNumber(body.passed_dedupe_gate, { min: 0, max: 1000000, decimals: 0 }) || 0,
      post_attempts: sanitizeNumber(body.post_attempts, { min: 0, max: 10000, decimals: 0 }) || 0,
      post_errors: sanitizeNumber(body.post_errors, { min: 0, max: 10000, decimals: 0 }) || 0,
      post_non_2xx: sanitizeNumber(body.post_non_2xx, { min: 0, max: 10000, decimals: 0 }) || 0,
      source_ip: clientIP,
      source_user: user.id,
    });

    // Log heartbeat ingestion (but not too verbosely - only if there are issues)
    if ((body.post_errors || 0) > 0 || (body.post_non_2xx || 0) > 0) {
      await auditLog(base44, {
        eventType: 'HEARTBEAT_WITH_ERRORS',
        severity: 'WARN',
        message: `Heartbeat received with errors: ${body.post_errors} POST errors, ${body.post_non_2xx} non-2xx`,
        details: {
          heartbeatId: heartbeat.id,
          postErrors: body.post_errors,
          postNon2xx: body.post_non_2xx,
          evaluations: body.evaluations,
          posted: body.posted,
        },
        userId: user.id,
        requestId,
        ipAddress: clientIP,
        entityType: 'ArbHeartbeat',
        entityId: heartbeat.id,
      });
    }

    // Add rate limit headers
    const rateLimitHeaders = await getRateLimitHeaders(base44, req, 'ingestHeartbeat');

    return Response.json({ ok: true, heartbeat_id: heartbeat.id }, {
      headers: rateLimitHeaders,
    });

  } catch (error) {
    console.error('ingestHeartbeat error:', error);

    // Log error
    try {
      const base44 = createClientFromRequest(req);
      await auditLog(base44, {
        eventType: 'HEARTBEAT_INGEST_ERROR',
        severity: 'ERROR',
        message: `Error ingesting heartbeat: ${error.message}`,
        details: { error: error.message, stack: error.stack },
        requestId,
        ipAddress: clientIP,
      });
    } catch {
      // If logging fails, just continue
    }

    return Response.json({ error: error.message, requestId }, { status: 500 });
  }
});
