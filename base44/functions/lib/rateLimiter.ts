/**
 * Rate Limiting Middleware for Base44 Functions
 * 
 * Provides per-IP and per-user rate limiting using Base44 entities for persistence.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX_REQUESTS = 30;

const ENDPOINT_LIMITS = {
  'ingestSignal': { windowMs: 60 * 1000, maxRequests: 60 },      // 1 per second
  'executeSignals': { windowMs: 60 * 1000, maxRequests: 10 },    // Slow execution
  'bybitTestConnection': { windowMs: 60 * 1000, maxRequests: 5 },
  'telegramWebhook': { windowMs: 60 * 1000, maxRequests: 120 },  // Telegram can be chatty
  'default': { windowMs: DEFAULT_WINDOW_MS, maxRequests: DEFAULT_MAX_REQUESTS },
};

/**
 * Get client IP from request
 */
export function getClientIP(req) {
  // Try various headers
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  const realIP = req.headers.get('x-real-ip');
  if (realIP) return realIP;
  
  const cfIP = req.headers.get('cf-connecting-ip');
  if (cfIP) return cfIP;
  
  // Fallback to a hash of the user agent (not ideal but better than nothing)
  return req.headers.get('user-agent') || 'unknown';
}

/**
 * Check rate limit for a key
 */
export async function checkRateLimit(base44, key, endpoint = 'default') {
  const limits = ENDPOINT_LIMITS[endpoint] || ENDPOINT_LIMITS.default;
  const now = Date.now();
  const windowStart = now - limits.windowMs;

  // Get or create rate limit record
  const records = await base44.asServiceRole.entities.ArbRateLimit.filter(
    { limit_key: key },
    '-created_date',
    1
  );

  let record = records[0];
  
  if (!record) {
    record = await base44.asServiceRole.entities.ArbRateLimit.create({
      limit_key: key,
      request_count: 1,
      window_start: new Date(now).toISOString(),
      last_request: new Date(now).toISOString(),
    });
    
    return { allowed: true, remaining: limits.maxRequests - 1, resetAt: now + limits.windowMs };
  }

  const windowStartTime = new Date(record.window_start).getTime();
  
  // Check if window has expired
  if (windowStartTime < windowStart) {
    // Reset window
    await base44.asServiceRole.entities.ArbRateLimit.update(record.id, {
      request_count: 1,
      window_start: new Date(now).toISOString(),
      last_request: new Date(now).toISOString(),
    });
    
    return { allowed: true, remaining: limits.maxRequests - 1, resetAt: now + limits.windowMs };
  }

  // Check if limit exceeded
  if (record.request_count >= limits.maxRequests) {
    const resetAt = windowStartTime + limits.windowMs;
    return { 
      allowed: false, 
      remaining: 0, 
      resetAt,
      retryAfter: Math.ceil((resetAt - now) / 1000),
    };
  }

  // Increment counter
  await base44.asServiceRole.entities.ArbRateLimit.update(record.id, {
    request_count: record.request_count + 1,
    last_request: new Date(now).toISOString(),
  });

  return { 
    allowed: true, 
    remaining: limits.maxRequests - record.request_count - 1,
    resetAt: windowStartTime + limits.windowMs,
  };
}

/**
 * Middleware wrapper for rate limiting
 */
export async function rateLimitMiddleware(req, base44, endpoint = 'default', options = {}) {
  const { 
    perUser = true, 
    perIP = true,
    skipAuthenticated = false 
  } = options;

  const keys = [];
  
  if (perIP) {
    const ip = getClientIP(req);
    keys.push(`ip:${ip}:${endpoint}`);
  }

  if (perUser) {
    try {
      const user = await base44.auth.me();
      if (user) {
        keys.push(`user:${user.id}:${endpoint}`);
      }
    } catch {
      // No authenticated user
    }
  }

  // Check all limits
  for (const key of keys) {
    const result = await checkRateLimit(base44, key, endpoint);
    
    if (!result.allowed) {
      return {
        blocked: true,
        response: new Response(JSON.stringify({
          error: 'Rate limit exceeded',
          retryAfter: result.retryAfter,
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(ENDPOINT_LIMITS[endpoint]?.maxRequests || DEFAULT_MAX_REQUESTS),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
            'Retry-After': String(result.retryAfter),
          },
        }),
      };
    }
  }

  return { blocked: false };
}

/**
 * Create rate limit headers for successful requests
 */
export async function getRateLimitHeaders(base44, req, endpoint = 'default') {
  const ip = getClientIP(req);
  const key = `ip:${ip}:${endpoint}`;
  const limits = ENDPOINT_LIMITS[endpoint] || ENDPOINT_LIMITS.default;
  
  const records = await base44.asServiceRole.entities.ArbRateLimit.filter(
    { limit_key: key },
    '-created_date',
    1
  );

  const record = records[0];
  const count = record ? record.request_count : 0;
  const resetAt = record 
    ? new Date(record.window_start).getTime() + limits.windowMs
    : Date.now() + limits.windowMs;

  return {
    'X-RateLimit-Limit': String(limits.maxRequests),
    'X-RateLimit-Remaining': String(Math.max(0, limits.maxRequests - count)),
    'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
  };
}

export default { checkRateLimit, rateLimitMiddleware, getRateLimitHeaders, getClientIP };
