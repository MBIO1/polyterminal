// Shared security utilities for backend functions

export function validateRequestOrigin(req, allowedHostname = 'polytrade.base44.app') {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  // Allow if no origin (non-browser requests are OK if authenticated)
  // For browser requests, validate origin/referer
  if (origin && !origin.includes(allowedHostname)) {
    return { valid: false, reason: 'invalid_origin' };
  }
  if (referer && !referer.includes(allowedHostname)) {
    return { valid: false, reason: 'invalid_referer' };
  }
  return { valid: true };
}

export function sanitizeErrorMessage(msg) {
  if (!msg) return 'unknown_error';
  const lower = msg.toLowerCase();
  if (lower.includes('key') || lower.includes('secret') || lower.includes('password')) {
    return 'credential_error';
  }
  if (lower.includes('sql') || lower.includes('database')) {
    return 'database_error';
  }
  return msg.slice(0, 100);
}

export function validateNumericRange(value, min, max, name = 'value') {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`${name} must be a valid number`);
  }
  if (num < min || num > max) {
    throw new Error(`${name} out of range [${min}, ${max}]`);
  }
  return num;
}