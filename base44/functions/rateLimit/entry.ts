// Simple rate limiter for signal ingestion
// Returns 429 if exceeded, otherwise 200 with token consumed

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SIGNALS_PER_MIN = 60; // 60 signals/min = 1 per second
const WINDOW_MS = 60000;

// In-memory tracker (resets on function restart)
let requestTracker = { count: 0, windowStart: Date.now() };

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = Date.now();
    
    // Reset window if expired
    if (now - requestTracker.windowStart > WINDOW_MS) {
      requestTracker = { count: 0, windowStart: now };
    }

    requestTracker.count++;

    if (requestTracker.count > SIGNALS_PER_MIN) {
      return Response.json(
        { error: 'Rate limit exceeded', remaining_sec: Math.ceil((requestTracker.windowStart + WINDOW_MS - now) / 1000) },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    return Response.json({
      ok: true,
      count_this_window: requestTracker.count,
      limit: SIGNALS_PER_MIN,
      reset_in_sec: Math.ceil((requestTracker.windowStart + WINDOW_MS - now) / 1000),
    });
  } catch (error) {
    console.error('[rateLimit] error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});