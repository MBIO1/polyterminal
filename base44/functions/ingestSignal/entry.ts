// Ingest qualified arbitrage signals from the external droplet WS bot.
// SECURITY ENHANCED VERSION
//
// Security improvements:
//   - Rate limiting per IP
//   - Input validation and sanitization
//   - Suspicious input detection
//   - Enhanced duplicate detection with fuzzy matching
//   - Comprehensive audit logging

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { rateLimitMiddleware, getRateLimitHeaders, getClientIP } from '../lib/rateLimiter.ts';
import { validateSignalData, sanitizeString, sanitizeNumber, detectSuspiciousInput } from '../lib/validation.ts';
import { auditLog, logSignalIngested, logSecurityEvent } from '../lib/auditLogger.ts';

// Trading floor thresholds
const TELEGRAM_ALERT_MIN_BPS = 20;
const TELEGRAM_NEAR_MISS_MIN_BPS = 6;
const NEAR_MISS_COOLDOWN_MS = 15 * 60 * 1000;
const lastNearMissByPair = new Map();

// ENHANCED: Fuzzy duplicate detection window (ms)
const DUPLICATE_WINDOW_MS = 30_000;
const PRICE_TOLERANCE_PCT = 0.001; // 0.1% price tolerance for duplicates

async function pushTelegramAlert(signal, kind = 'full') {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return;

  const edge = Number(signal.net_edge_bps || 0);
  const raw = Number(signal.raw_spread_bps || 0);
  const fill = Math.round(Number(signal.fillable_size_usd || 0));
  const ageMs = Number(signal.signal_age_ms || 0);

  const isNearMiss = kind === 'near_miss';
  const profitLabel = edge >= 20 ? '✅ TRADEABLE' : edge >= 10 ? '⚠️ NEAR-MISS' : '📊 MONITORING';
  const header = isNearMiss
    ? `👀 <b>NEAR-MISS · ${edge.toFixed(1)} bps</b> <i>(below 20 bps floor — watching only)</i>\n${profitLabel}`
    : `${edge >= 40 ? '🚨🚨' : edge >= 25 ? '🚨' : '⚡'} <b>ARB SIGNAL · ${edge.toFixed(1)} bps</b>\n${profitLabel}`;

  const feesCost = 4 * 2;
  const profitExplain = edge >= 20
    ? `💰 Est. profit: ~${(edge - feesCost).toFixed(1)} bps after fees on $${fill.toLocaleString()}`
    : `⚠️ Edge ${edge.toFixed(1)} bps < 20 bps floor — NOT executed (fees = ${feesCost} bps)`;

  const text = [
    header,
    '━━━━━━━━━━━━━━━━━━━━━',
    `<b>Pair:</b> ${signal.pair}`,
    `<b>Route:</b> ${signal.buy_exchange} → ${signal.sell_exchange}`,
    `<b>Buy @ </code>${Number(signal.buy_price).toFixed(4)}</code>  <b>Sell @ </code>${Number(signal.sell_price).toFixed(4)}</code>`,
    `<b>Raw spread:</b> ${raw.toFixed(2)} bps  |  <b>Net edge:</b> <code>${edge.toFixed(2)} bps</code>`,
    `<b>Fillable:</b> $${fill.toLocaleString()}  |  <b>Age:</b> ${ageMs} ms`,
    profitExplain,
    signal.notes ? `<i>${signal.notes}</i>` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Telegram push failed:', res.status, err);
    }
  } catch (e) {
    console.error('Telegram push exception:', e.message);
  }
}

// ENHANCED: Fuzzy duplicate detection
async function checkFuzzyDuplicate(base44, signal) {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
  
  // Get recent signals for same pair
  const recent = await base44.asServiceRole.entities.ArbSignal.filter(
    { pair: signal.pair },
    '-received_time',
    10,
  );

  for (const existing of recent) {
    const ageMs = Date.now() - new Date(existing.received_time || existing.created_date).getTime();
    if (ageMs > DUPLICATE_WINDOW_MS) continue;

    // Check if exchanges match
    const sameExchanges = 
      existing.buy_exchange === signal.buy_exchange &&
      existing.sell_exchange === signal.sell_exchange;

    if (!sameExchanges) continue;

    // Check price proximity (within 0.1%)
    const buyPriceDiff = Math.abs((existing.buy_price - signal.buy_price) / signal.buy_price);
    const sellPriceDiff = Math.abs((existing.sell_price - signal.sell_price) / signal.sell_price);

    if (buyPriceDiff < PRICE_TOLERANCE_PCT && sellPriceDiff < PRICE_TOLERANCE_PCT) {
      return {
        isDuplicate: true,
        existingId: existing.id,
        priceDiffPct: Math.max(buyPriceDiff, sellPriceDiff) * 100,
      };
    }
  }

  return { isDuplicate: false };
}

Deno.serve(async (req) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const clientIP = getClientIP(req);

  try {
    // Method check
    if (req.method !== 'POST') {
      return Response.json({ error: 'POST only' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);

    // ENHANCED: Rate limiting
    const rateLimitCheck = await rateLimitMiddleware(req, base44, 'ingestSignal', {
      perUser: true,
      perIP: true,
    });

    if (rateLimitCheck.blocked) {
      await logSecurityEvent(base44, 'RATE_LIMIT_EXCEEDED', {
        clientIP,
        endpoint: 'ingestSignal',
      }, { severity: 'WARN', ipAddress: clientIP });

      return rateLimitCheck.response;
    }

    // Authentication
    const user = await base44.auth.me();
    if (!user) {
      await logSecurityEvent(base44, 'UNAUTHORIZED_ACCESS_ATTEMPT', {
        clientIP,
        endpoint: 'ingestSignal',
      }, { severity: 'ERROR', ipAddress: clientIP });

      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
      await logSecurityEvent(base44, 'SUSPICIOUS_INPUT_DETECTED', {
        issues: suspiciousCheck.issues,
        clientIP,
        userId: user.id,
      }, { severity: 'ERROR', userId: user.id, ipAddress: clientIP });

      return Response.json({ error: 'Invalid input detected' }, { status: 400 });
    }

    // ENHANCED: Validate and sanitize input
    const validation = validateSignalData(body);
    if (!validation.valid) {
      await auditLog(base44, {
        eventType: 'SIGNAL_VALIDATION_FAILED',
        severity: 'WARN',
        message: 'Signal validation failed',
        details: { errors: validation.errors, body },
        userId: user.id,
        requestId,
        ipAddress: clientIP,
      });

      return Response.json({ error: 'Validation failed', details: validation.errors }, { status: 400 });
    }

    const data = validation.sanitized;

    // Required fields check
    const required = ['pair', 'buy_exchange', 'sell_exchange', 'raw_spread_bps', 'net_edge_bps'];
    for (const k of required) {
      if (data[k] === undefined || data[k] === null) {
        return Response.json({ error: `Missing field: ${k}` }, { status: 400 });
      }
    }

    const asset = data.asset || (data.pair || '').split('-')[0] || 'Other';
    const now = new Date().toISOString();

    // ENHANCED: Fuzzy duplicate detection
    const duplicateCheck = await checkFuzzyDuplicate(base44, data);
    if (duplicateCheck.isDuplicate) {
      await auditLog(base44, {
        eventType: 'SIGNAL_DUPLICATE_DETECTED',
        severity: 'DEBUG',
        message: `Duplicate signal detected (within ${PRICE_TOLERANCE_PCT * 100}% price tolerance)`,
        details: {
          existingId: duplicateCheck.existingId,
          priceDiffPct: duplicateCheck.priceDiffPct,
        },
        userId: user.id,
        requestId,
        ipAddress: clientIP,
      });

      return Response.json({ 
        ok: true, 
        duplicate: true, 
        signal_id: duplicateCheck.existingId,
        priceDiffPct: duplicateCheck.priceDiffPct,
      });
    }

    // Create signal
    const signal = await base44.asServiceRole.entities.ArbSignal.create({
      signal_time: body.signal_time || now,
      received_time: now,
      pair: data.pair,
      asset,
      buy_exchange: data.buy_exchange,
      sell_exchange: data.sell_exchange,
      buy_price: sanitizeNumber(data.buy_price, { min: 0, max: 1000000000, decimals: 8 }),
      sell_price: sanitizeNumber(data.sell_price, { min: 0, max: 1000000000, decimals: 8 }),
      raw_spread_bps: sanitizeNumber(data.raw_spread_bps, { min: -10000, max: 10000, decimals: 2 }),
      net_edge_bps: sanitizeNumber(data.net_edge_bps, { min: -10000, max: 10000, decimals: 2 }),
      buy_depth_usd: sanitizeNumber(data.buy_depth_usd, { min: 0, max: 1000000000, decimals: 2 }),
      sell_depth_usd: sanitizeNumber(data.sell_depth_usd, { min: 0, max: 1000000000, decimals: 2 }),
      fillable_size_usd: sanitizeNumber(data.fillable_size_usd, { min: 0, max: 1000000000, decimals: 2 }),
      signal_age_ms: sanitizeNumber(data.signal_age_ms, { min: 0, max: 300000, decimals: 0 }),
      exchange_latency_ms: sanitizeNumber(data.exchange_latency_ms, { min: 0, max: 60000, decimals: 0 }),
      confirmed_exchanges: sanitizeNumber(data.confirmed_exchanges, { min: 1, max: 10, decimals: 0 }),
      status: body.alert ? 'alerted' : 'detected',
      notes: sanitizeString(body.notes || '', 1000),
      source_ip: clientIP,
      source_user: user.id,
    });

    // ENHANCED: Log signal ingestion
    await logSignalIngested(base44, signal, {
      source: 'droplet',
      userId: user.id,
      ipAddress: clientIP,
    });

    // Telegram alert for signals above threshold
    const edgeBps = Number(data.net_edge_bps);
    if (edgeBps >= TELEGRAM_ALERT_MIN_BPS) {
      await pushTelegramAlert({ ...data, ...signal }, 'full');
    } else if (edgeBps >= TELEGRAM_NEAR_MISS_MIN_BPS) {
      const last = lastNearMissByPair.get(data.pair) || 0;
      if (Date.now() - last >= NEAR_MISS_COOLDOWN_MS) {
        lastNearMissByPair.set(data.pair, Date.now());
        await pushTelegramAlert({ ...data, ...signal }, 'near_miss');
      }
    }

    // Optional fan-out alert
    if (body.alert) {
      await base44.asServiceRole.functions.invoke('slackAlert', {
        alert_type: 'funding_anomaly',
        severity: Number(data.net_edge_bps) >= 25 ? 'High' : 'Medium',
        title: `${data.pair} ${Number(data.net_edge_bps).toFixed(1)} bps · ${data.buy_exchange}→${data.sell_exchange}`,
        description: `Buy ${data.buy_exchange} @ ${Number(data.buy_price).toFixed(2)} · Sell ${data.sell_exchange} @ ${Number(data.sell_price).toFixed(2)}. Fillable ~$${Math.round(data.fillable_size_usd || 0).toLocaleString()}.`,
        fields: [
          { title: 'Pair', value: data.pair },
          { title: 'Raw spread', value: `${Number(data.raw_spread_bps).toFixed(2)} bps` },
          { title: 'Net edge', value: `${Number(data.net_edge_bps).toFixed(2)} bps` },
          { title: 'Buy depth', value: `$${Math.round(data.buy_depth_usd || 0).toLocaleString()}` },
          { title: 'Sell depth', value: `$${Math.round(data.sell_depth_usd || 0).toLocaleString()}` },
          { title: 'Signal age', value: `${data.signal_age_ms || 0} ms` },
          { title: 'Confirmed', value: `${data.confirmed_exchanges || 1}/4` },
        ],
      });
    }

    // Add rate limit headers
    const rateLimitHeaders = await getRateLimitHeaders(base44, req, 'ingestSignal');

    return Response.json({ ok: true, signal_id: signal.id }, {
      headers: rateLimitHeaders,
    });

  } catch (error) {
    console.error('ingestSignal error:', error);

    // Log error
    try {
      const base44 = createClientFromRequest(req);
      await auditLog(base44, {
        eventType: 'SIGNAL_INGEST_ERROR',
        severity: 'ERROR',
        message: `Error ingesting signal: ${error.message}`,
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
