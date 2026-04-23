// Auto-executor: CEX Arbitrage Skill 2.0 - SECURITY ENHANCED
//
// SECURITY IMPROVEMENTS:
//   - Rate limiting per IP and user
//   - Distributed locking for trade deduplication
//   - Enhanced slippage model with volatility adjustment
//   - Input validation and sanitization
//   - Circuit breaker for consecutive failures
//   - Comprehensive audit logging
//   - Secure API key management
//
// THREE PILLARS:
//   PILLAR 1 — Staleness detection: signals older than TTL are expired
//   PILLAR 2 — Real spread: recomputes net edge with dynamic fee tier + enhanced slippage model
//   PILLAR 3 — Risk/circuit-breakers: daily drawdown, margin util, delta drift, failure tracking

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { rateLimitMiddleware, getRateLimitHeaders, getClientIP } from '../lib/rateLimiter.ts';
import { withLock, getAssetLockName } from '../lib/lockManager.ts';
import { 
  calculateVolatilityAdjustedSlippage, 
  calculateSafePositionSize,
  validateSlippage,
  validateTradeParams 
} from '../lib/tradingMath.ts';
import { validateSignalData, sanitizeNumber, detectSuspiciousInput } from '../lib/validation.ts';
import { recordFailure, getCircuitBreakerStatus } from '../lib/circuitBreaker.ts';
import { 
  auditLog, 
  logTradeExecution, 
  logSignalRejected,
  logApiError,
  logSecurityEvent
} from '../lib/auditLogger.ts';
import { getApiCredentials } from '../lib/secretsManager.ts';

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 1 — Staleness helpers
// ─────────────────────────────────────────────────────────────────────────────

function signalAgeMs(signal) {
  const refTs = new Date(signal.received_time || signal.created_date).getTime();
  return Date.now() - refTs;
}

function signalConfidence(signal, signalTtlMs) {
  const age = signalAgeMs(signal);
  const ttl = signalTtlMs || 300_000;
  const ageFraction = Math.min(age / ttl, 1);
  const agePts = 50 * (1 - ageFraction);

  const confirmed = Number(signal.confirmed_exchanges || 1);
  const confirmPts = confirmed >= 3 ? 40 : confirmed >= 2 ? 30 : 15;

  const fillable = Number(signal.fillable_size_usd || 0);
  const fillPts = Math.min(fillable / 1000, 1) * 10;

  return Math.min(100, Math.max(0, Math.round(agePts + confirmPts + fillPts)));
}

function marketCondition(confidence) {
  if (confidence >= 80) return 'HEALTHY';
  if (confidence >= 60) return 'VOLATILE';
  if (confidence >= 40) return 'UNCERTAIN';
  return 'STALE';
}

function sizeMultiplier(confidence) {
  if (confidence >= 80) return 1.00;
  if (confidence >= 60) return 0.50;
  if (confidence >= 40) return 0.25;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 2 — Enhanced Real spread / cost model with volatility adjustment
// ─────────────────────────────────────────────────────────────────────────────

function effectiveFeeBps(config) {
  const perLeg = Number(config.taker_fee_bps_per_leg ?? 2);
  return perLeg > 0 ? perLeg : 2;
}

// ENHANCED: Use volatility-adjusted slippage model
function estimatedSlippageBpsEnhanced(sizeUsd, fillableUsd, profileName, volatility24h = 0.02) {
  const result = calculateVolatilityAdjustedSlippage(
    sizeUsd,
    fillableUsd,
    volatility24h,
    profileName,
    'normal'
  );
  return result.slippageBps;
}

function getExecutionProfile(asset, config) {
  const profiles = config.execution_profiles || {};
  const assetConfig = config.asset_execution?.[asset] || {};
  const profileName = assetConfig.profile || 'Conservative';
  return { name: profileName, max_notional_usd: assetConfig.max_notional_usd, ...profiles[profileName] };
}

// ENHANCED: Recompute net edge with enhanced slippage and validation
function recomputeNetEdgeEnhanced(signal, config, sizeUsd, isBatchMode, volatility24h = 0.02) {
  const rawBps = Number(signal.raw_spread_bps || 0);
  const asset = signal.asset || 'Other';
  const profile = getExecutionProfile(asset, config);

  const feeBps = effectiveFeeBps(config);
  const slipBps = estimatedSlippageBpsEnhanced(
    sizeUsd, 
    Number(signal.fillable_size_usd || 0), 
    profile.name,
    volatility24h
  );

  // Validate slippage is acceptable
  const slippageValidation = validateSlippage(slipBps, profile.name === 'Aggressive' ? 35 : 20);

  const safetyBps = (isBatchMode || config.paper_trading) ? 0.5 : 2.0;
  const floorBps = config.paper_trading ? 0 : (isBatchMode ? 2.0 : 3.0);

  const requiredEdge = 2 * feeBps + slipBps + safetyBps;
  const gatedEdge = Math.max(requiredEdge, floorBps);
  const net = rawBps - gatedEdge;

  return { 
    rawBps, 
    feeBps, 
    slipBps, 
    safetyBps, 
    floorBps, 
    requiredEdge, 
    gatedEdge, 
    net, 
    profile: profile.name, 
    max_notional: profile.max_notional_usd,
    slippageWarning: slippageValidation.warning || null,
    slippageValid: slippageValidation.valid,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 3 — Enhanced Gate checks with circuit breaker awareness
// ─────────────────────────────────────────────────────────────────────────────

async function checkGatesEnhanced({ signal, config, todayPnl, openPositions, sizeUsd, isBatchMode, base44 }) {
  const reasons = [];

  // Check circuit breaker status first
  const cbStatus = await getCircuitBreakerStatus(base44);
  if (cbStatus.isHalted) {
    reasons.push(`circuit_breaker_active(halt_until=${cbStatus.haltUntil})`);
    return { allowed: false, reasons, recomputedNetBps: 0, circuitBreakerActive: true };
  }

  if (config.kill_switch_active) reasons.push('kill_switch_active');
  if (!config.bot_running) reasons.push('bot_not_running');

  const now = Date.now();
  if (config.halt_until_ts && config.halt_until_ts > now) reasons.push('halt_active');

  // Enhanced edge gate with volatility adjustment
  const asset = signal.asset || 'Other';
  // Estimate volatility (in production, this would come from market data)
  const estimatedVol = asset === 'BTC' ? 0.025 : asset === 'ETH' ? 0.03 : 0.04;
  
  const { 
    rawBps, 
    feeBps, 
    slipBps, 
    safetyBps, 
    floorBps, 
    requiredEdge, 
    gatedEdge, 
    net: recomputedNetBps, 
    profile, 
    max_notional,
    slippageWarning,
    slippageValid 
  } = recomputeNetEdgeEnhanced(signal, config, sizeUsd, isBatchMode, estimatedVol);

  if (slippageWarning) {
    reasons.push(`slippage_warning:${slippageWarning}`);
  }

  // Min edge calculation
  const minEdgeBtc = config.paper_trading ? 0.25 : (config.btc_min_edge_bps != null ? Number(config.btc_min_edge_bps) : 0);
  const minEdgeEth = config.paper_trading ? 0.25 : (config.eth_min_edge_bps != null ? Number(config.eth_min_edge_bps) : 0);
  const minEdge =
    asset === 'BTC' ? minEdgeBtc :
    asset === 'ETH' ? minEdgeEth :
    Math.min(minEdgeBtc, minEdgeEth);

  if (recomputedNetBps < minEdge) {
    reasons.push(`edge_below_min(raw=${rawBps.toFixed(1)},fees=${feeBps}×2,slip=${slipBps.toFixed(1)},safety=${safetyBps},floor=${floorBps},gated=${gatedEdge.toFixed(1)},net=${recomputedNetBps.toFixed(1)}<${minEdge},batch=${isBatchMode})`);
  }

  // Asset-specific notional gate
  if (max_notional && sizeUsd > max_notional) {
    reasons.push(`max_notional_breach(${sizeUsd}>${max_notional})`);
  }

  // ENHANCED: Check safe position size based on liquidity
  const safeSize = calculateSafePositionSize(Number(signal.fillable_size_usd || 0), 20);
  if (sizeUsd > safeSize * 1.2) { // Allow 20% buffer
    reasons.push(`exceeds_safe_liquidity(safe=${safeSize.toFixed(0)},requested=${sizeUsd})`);
  }

  // Daily drawdown circuit breaker
  const totalCap = Number(config.total_capital || 0);
  const ddCap = totalCap * Number(config.max_daily_drawdown_pct || 0.01);
  if (todayPnl < -ddCap) reasons.push(`daily_drawdown_breach(${todayPnl.toFixed(2)})`);

  // Margin utilization circuit breaker
  const perpBucket = totalCap * Number(config.perp_collateral_pct || 0.245);
  const marginUsed = (openPositions || []).reduce((a, p) => a + Number(p.margin_used || 0), 0);
  const marginUtil = perpBucket > 0 ? marginUsed / perpBucket : 0;
  if (marginUtil >= Number(config.max_margin_utilization_pct || 0.35)) {
    reasons.push(`margin_util_breach(${(marginUtil * 100).toFixed(1)}%)`);
  }

  // Delta drift circuit breaker
  const netDelta = (openPositions || []).reduce((a, p) => a + Number(p.net_delta_usd || 0), 0);
  const deltaCap = totalCap * Number(config.max_net_delta_drift_pct || 0.001);
  if (Math.abs(netDelta) > deltaCap) {
    reasons.push(`delta_drift_breach(${netDelta.toFixed(2)})`);
  }

  // Liquidity gate
  const minFill = Number(config.min_fillable_usd || 200);
  if (Number(signal.fillable_size_usd || 0) < minFill) {
    reasons.push(`insufficient_liquidity(${signal.fillable_size_usd})`);
  }

  // Log gate check results for audit
  await auditLog(base44, {
    eventType: 'GATE_CHECK',
    severity: reasons.length > 0 ? 'WARN' : 'DEBUG',
    message: `Gate check for signal ${signal.id}: ${reasons.length > 0 ? 'REJECTED' : 'PASSED'}`,
    details: {
      signalId: signal.id,
      pair: signal.pair,
      asset,
      profile,
      rawBps,
      feeBps,
      slipBps,
      recomputedNetBps,
      minEdge,
      reasons,
    },
    entityType: 'ArbSignal',
    entityId: signal.id,
  });

  return { 
    allowed: reasons.length === 0, 
    reasons, 
    recomputedNetBps,
    circuitBreakerActive: false,
    slippageWarning,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sizing — with confidence and safety limits
// ─────────────────────────────────────────────────────────────────────────────

function sizeTradeEnhanced({ signal, config, confidence }) {
  const totalCap = Number(config.total_capital || 0);
  const spotBucket = totalCap * Number(config.spot_allocation_pct || 0.35);
  const perTradeCap = spotBucket * 0.10;
  const fillable = Number(signal.fillable_size_usd || 0);
  
  // ENHANCED: Apply safe position size limit
  const safeSize = calculateSafePositionSize(fillable, 20);
  
  const mult = sizeMultiplier(confidence);
  const rawSize = Math.min(perTradeCap, fillable, safeSize) * mult;
  
  return Math.max(0, Math.floor(rawSize));
}

// ─────────────────────────────────────────────────────────────────────────────
// ENHANCED: Order execution with secure credential management
// ─────────────────────────────────────────────────────────────────────────────

async function bybitSign(preSign, apiSecret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(preSign));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function bybitPostEnhanced(path, body, base44) {
  const isTestnet = (Deno.env.get('BYBIT_TESTNET') || 'true').toLowerCase() !== 'false';
  const base = isTestnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
  
  // ENHANCED: Use secure credential retrieval
  let apiKey, apiSecret;
  try {
    const creds = await getApiCredentials(base44, 'BYBIT');
    apiKey = creds.apiKey;
    apiSecret = creds.apiSecret;
  } catch (e) {
    throw new Error('Bybit API credentials not configured');
  }

  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const bodyStr = JSON.stringify(body);
  const preSign = timestamp + apiKey + recvWindow + bodyStr;
  const signature = await bybitSign(preSign, apiSecret);

  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'Content-Type': 'application/json',
    },
    body: bodyStr,
  });
  
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  
  // Log API call for audit
  await auditLog(base44, {
    eventType: 'EXCHANGE_API_CALL',
    severity: json.retCode === 0 ? 'DEBUG' : 'WARN',
    message: `Bybit API ${path}: ${json.retCode === 0 ? 'success' : 'failed'}`,
    details: {
      endpoint: path,
      retCode: json.retCode,
      retMsg: json.retMsg,
      environment: isTestnet ? 'testnet' : 'mainnet',
    },
  });
  
  return { httpStatus: res.status, body: json, environment: isTestnet ? 'testnet' : 'mainnet' };
}

async function bybitPlaceOrderWithRetryEnhanced({ category, symbol, side, qty }, maxRetries, base44) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 200 * attempt));
    }
    try {
      const result = await bybitPostEnhanced('/v5/order/create', {
        category, symbol, side,
        orderType: 'Market', qty: String(qty), timeInForce: 'IOC',
      }, base44);
      
      if (result.body?.retCode === 0) return { ...result, attempt };
      
      lastError = result.body?.retMsg || 'non-zero retCode';
      console.warn(`Bybit order attempt ${attempt + 1} failed: ${lastError}`);
      
      // Record API error for circuit breaker
      await recordFailure(base44, 'api_error', {
        exchange: 'bybit',
        endpoint: '/v5/order/create',
        attempt: attempt + 1,
        error: lastError,
      });
      
    } catch (e) {
      lastError = e.message;
      console.warn(`Bybit order attempt ${attempt + 1} threw: ${lastError}`);
      
      await recordFailure(base44, 'execution_error', {
        exchange: 'bybit',
        attempt: attempt + 1,
        error: lastError,
      });
    }
  }
  throw new Error(`Order failed after ${maxRetries} attempts: ${lastError}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ENHANCED: Execution routing with distributed locking
// ─────────────────────────────────────────────────────────────────────────────

async function routeExecutionEnhanced({ signal, sizeUsd, paperTrading, base44 }) {
  const asset = signal.asset || 'BTC';
  const symbol = `${asset}USDT`;
  const buyVenue = (signal.buy_exchange || '').toLowerCase();
  const sellVenue = (signal.sell_exchange || '').toLowerCase();

  const buyPx = Number(signal.buy_price) || 0;
  const sellPx = Number(signal.sell_price) || 0;
  if (!buyPx || !sellPx) throw new Error('missing prices');

  const qty = Number((sizeUsd / buyPx).toFixed(6));

  const bybitIsBuy = buyVenue.includes('bybit');
  const bybitIsSell = sellVenue.includes('bybit');
  const liveCapable = !paperTrading && (bybitIsBuy || bybitIsSell);

  if (!liveCapable) {
    return {
      mode: 'paper',
      reason: paperTrading ? 'config.paper_trading=true' : 'no_bybit_leg',
      fills: {
        buy: { venue: signal.buy_exchange, px: buyPx, qty, notional_usd: qty * buyPx },
        sell: { venue: signal.sell_exchange, px: sellPx, qty, notional_usd: qty * sellPx },
      },
    };
  }

  // ENHANCED: Acquire distributed lock for this asset
  const lockName = getAssetLockName(asset, 'execution');
  
  return await withLock(
    base44,
    lockName,
    async (lock) => {
      const liveLeg = bybitIsBuy
        ? { venue: 'Bybit', side: 'Buy', px: buyPx }
        : { venue: 'Bybit', side: 'Sell', px: sellPx };
      const simLeg = bybitIsBuy
        ? { venue: signal.sell_exchange, side: 'Sell', px: sellPx }
        : { venue: signal.buy_exchange, side: 'Buy', px: buyPx };

      // Execute with retry
      const live = await bybitPlaceOrderWithRetryEnhanced({
        category: 'spot', symbol, side: liveLeg.side, qty,
      }, 3, base44);

      // Extend lock during execution
      await lock.extend(10000);

      return {
        mode: 'live_partial',
        fills: {
          [liveLeg.side.toLowerCase()]: {
            venue: 'Bybit', px: liveLeg.px, qty, notional_usd: qty * liveLeg.px,
            order_id: live?.body?.result?.orderId,
            retCode: live?.body?.retCode, retMsg: live?.body?.retMsg,
            attempt: live?.attempt, environment: live.environment,
          },
          [simLeg.side.toLowerCase()]: {
            venue: simLeg.venue, px: simLeg.px, qty, notional_usd: qty * simLeg.px,
            simulated: true,
          },
        },
        bybit_ok: live?.body?.retCode === 0,
      };
    },
    { 
      ttlMs: 30000, // 30 second lock
      owner: `executeSignals:${signal.id}`,
      onLockFail: async () => {
        // Another execution is in progress for this asset
        await logSignalRejected(base44, signal, ['concurrent_execution_lock'], {
          userId: 'system',
        });
        throw new Error(`Concurrent execution detected for asset ${asset}`);
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch-mode ranking & scoring
// ─────────────────────────────────────────────────────────────────────────────

function scoreSignal(signal, netEdgeBps) {
  const agePenalty = Number(signal.signal_age_ms || 0) / 1000;
  const sizePenalty = Number(signal.fillable_size_usd || 0) * 0.0001;
  return netEdgeBps - agePenalty - sizePenalty;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENHANCED: Main handler with all security features
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const clientIP = getClientIP(req);
  
  try {
    const base44 = createClientFromRequest(req);
    
    // ENHANCED: Rate limiting check
    const rateLimitCheck = await rateLimitMiddleware(req, base44, 'executeSignals', {
      perUser: true,
      perIP: true,
    });
    
    if (rateLimitCheck.blocked) {
      await logSecurityEvent(base44, 'RATE_LIMIT_EXCEEDED', {
        clientIP,
        endpoint: 'executeSignals',
      }, { severity: 'WARN', ipAddress: clientIP });
      
      return rateLimitCheck.response;
    }
    
    // Authentication
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'admin') {
      await logSecurityEvent(base44, 'UNAUTHORIZED_ACCESS_ATTEMPT', {
        userId: user.id,
        role: user.role,
        endpoint: 'executeSignals',
      }, { severity: 'ERROR', userId: user.id, ipAddress: clientIP });
      
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    // Parse and validate body
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    
    // ENHANCED: Check for suspicious input
    const suspiciousCheck = detectSuspiciousInput(body);
    if (suspiciousCheck.suspicious) {
      await logSecurityEvent(base44, 'SUSPICIOUS_INPUT_DETECTED', {
        issues: suspiciousCheck.issues,
        clientIP,
      }, { severity: 'ERROR', userId: user.id, ipAddress: clientIP });
      
      return Response.json({ error: 'Invalid input detected' }, { status: 400 });
    }

    const dryRun = body.dry_run === true;
    const maxSignals = Math.min(sanitizeNumber(body.max_signals, { min: 1, max: 50, decimals: 0 }) || 25, 50);
    const minConfirmedCross = sanitizeNumber(body.min_confirmed, { min: 1, max: 5, decimals: 0 }) || 2;
    const forceSignalId = body.signal_id || null;
    const signalTtlMs = sanitizeNumber(body.signal_ttl_ms, { min: 60000, max: 1800000, decimals: 0 }) || 600_000;
    const batchThreshold = sanitizeNumber(body.batch_threshold, { min: 1, max: 20, decimals: 0 }) || 10;
    const batchTopN = sanitizeNumber(body.batch_top_n, { min: 1, max: 10, decimals: 0 }) || 5;

    // Load config
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config = configs?.[0];
    if (!config) return Response.json({ error: 'No ArbConfig found' }, { status: 400 });

    // Log execution start
    await auditLog(base44, {
      eventType: 'EXECUTION_STARTED',
      severity: 'INFO',
      message: `Signal execution started${dryRun ? ' (DRY RUN)' : ''}`,
      details: { dryRun, maxSignals, forceSignalId },
      userId: user.id,
      requestId,
      ipAddress: clientIP,
    });

    let candidates;
    const nowTs = Date.now();
    const expiredIds = [];

    if (forceSignalId) {
      const recent = await base44.asServiceRole.entities.ArbSignal.list('-received_time', 200);
      const found = recent.find(s => s.id === forceSignalId);
      if (!found) return Response.json({ error: `Signal ${forceSignalId} not found` }, { status: 404 });
      candidates = [found];
    } else {
      const recentAll = await base44.asServiceRole.entities.ArbSignal.list('-received_time', 200);
      const venueRoot = (v) => String(v || '').replace(/-(spot|perp|swap|futures)$/i, '').trim().toLowerCase();
      const pending = recentAll.filter(s => ['detected', 'alerted'].includes(s.status));

      const fresh = [];
      for (const s of pending) {
        const ageMs = nowTs - new Date(s.received_time || s.created_date).getTime();
        if (ageMs > signalTtlMs) {
          expiredIds.push({ id: s.id, age_ms: ageMs, pair: s.pair });
        } else {
          fresh.push(s);
        }
      }

      if (!dryRun && expiredIds.length > 0) {
        await Promise.all(expiredIds.map(e =>
          base44.asServiceRole.entities.ArbSignal.update(e.id, {
            status: 'expired',
            rejection_reason: `ttl_exceeded(${Math.round(e.age_ms / 1000)}s)`,
          }).catch(err => console.error('expire failed', e.id, err.message))
        ));
      }

      candidates = fresh
        .filter(s => {
          const sameVenue = venueRoot(s.buy_exchange) === venueRoot(s.sell_exchange) && venueRoot(s.buy_exchange) !== '';
          const required = sameVenue ? 1 : minConfirmedCross;
          return Number(s.confirmed_exchanges || 0) >= required;
        })
        .slice(0, maxSignals);
    }

    const isBatchMode = candidates.length >= batchThreshold;

    // Today's PnL + open positions
    const todayStr = new Date().toISOString().slice(0, 10);
    const [closedToday, openPositions] = await Promise.all([
      base44.asServiceRole.entities.ArbTrade.filter({ status: 'Closed', trade_date: todayStr }, '-updated_date', 100),
      base44.asServiceRole.entities.ArbLivePosition.filter({ status: 'Open' }, '-snapshot_time', 50),
    ]);
    const todayPnl = closedToday.reduce((a, t) => a + Number(t.net_pnl || 0), 0);

    // Score and filter candidates
    const scoredCandidates = [];
    for (const sig of candidates) {
      const confidence = signalConfidence(sig, signalTtlMs);
      const condition = marketCondition(confidence);
      
      if (condition === 'STALE' && !forceSignalId) continue;
      
      const sizeUsd = sizeTradeEnhanced({ signal: sig, config, confidence });
      if (sizeUsd <= 0) continue;

      const gates = await checkGatesEnhanced({ 
        signal: sig, 
        config, 
        todayPnl, 
        openPositions, 
        sizeUsd, 
        isBatchMode,
        base44 
      });
      
      if (!gates.allowed && !forceSignalId) continue;

      const score = scoreSignal(sig, gates.recomputedNetBps);
      scoredCandidates.push({ score, sig, confidence, condition, sizeUsd, gates });
    }

    // Sort and select top candidates
    scoredCandidates.sort((a, b) => b.score - a.score);
    const toProcess = isBatchMode && scoredCandidates.length > batchTopN
      ? scoredCandidates.slice(0, batchTopN)
      : scoredCandidates;

    const results = [];
    let tradeCounter = 1;
    const reservedAssets = new Set();

    for (const { score, sig, confidence, condition, sizeUsd, gates } of toProcess) {
      // Per-asset deduplication
      if (isBatchMode && reservedAssets.has(sig.asset)) {
        if (!dryRun) {
          await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
            status: 'rejected',
            rejection_reason: `duplicate_asset_in_batch(asset=${sig.asset})`,
          });
        }
        
        await logSignalRejected(base44, sig, ['duplicate_asset_in_batch'], { userId: user.id, requestId });
        
        results.push({
          signal_id: sig.id, pair: sig.pair,
          decision: 'rejected', reasons: [`duplicate_asset_in_batch`], confidence,
        });
        continue;
      }

      // Stale signal check
      if (condition === 'STALE' && !forceSignalId) {
        if (!dryRun) {
          await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
            status: 'rejected',
            rejection_reason: `stale_signal(confidence=${confidence})`,
          });
        }
        
        await logSignalRejected(base44, sig, [`stale_signal(confidence=${confidence})`], { userId: user.id, requestId });
        
        results.push({ signal_id: sig.id, pair: sig.pair, decision: 'rejected', reasons: [`stale_signal(confidence=${confidence})`], confidence });
        continue;
      }

      if (sizeUsd <= 0) {
        if (!dryRun) {
          await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
            status: 'rejected', rejection_reason: `size_zero(condition=${condition},confidence=${confidence})`,
          });
        }
        
        await logSignalRejected(base44, sig, [`size_zero_${condition}`], { userId: user.id, requestId });
        
        results.push({ signal_id: sig.id, decision: 'rejected', reasons: [`size_zero_${condition}`], confidence });
        continue;
      }

      // Gate checks
      const ageMs = signalAgeMs(sig);
      const forceOlderThan1Min = ageMs > 60_000 && !forceSignalId;

      if (!gates.allowed && !forceOlderThan1Min) {
        if (!dryRun) {
          await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
            status: 'rejected', rejection_reason: gates.reasons.join(','),
          });
        }
        
        await logSignalRejected(base44, sig, gates.reasons, { userId: user.id, requestId });
        
        results.push({
          signal_id: sig.id, pair: sig.pair, net_edge_bps: sig.net_edge_bps,
          decision: 'rejected', reasons: gates.reasons, confidence, condition,
        });
        continue;
      }
      
      if (!gates.allowed && forceOlderThan1Min) {
        console.log(`FORCE EXECUTE: signal ${sig.id} (${sig.pair}) age=${ageMs}ms > 60s, bypassing edge gate`);
      }

      if (dryRun) {
        results.push({
          signal_id: sig.id, pair: sig.pair, net_edge_bps: sig.net_edge_bps,
          decision: 'would_execute', size_usd: sizeUsd, confidence, condition,
          recomputed_net_bps: gates.recomputedNetBps,
        });
        continue;
      }

      // Execute with distributed locking
      let execResult, execError;
      try {
        execResult = await routeExecutionEnhanced({
          signal: sig, sizeUsd, paperTrading: config.paper_trading !== false, base44,
        });
      } catch (e) {
        console.error('execution error', sig.id, e);
        execError = e.message;
        
        // Record failure for circuit breaker
        await recordFailure(base44, 'execution_error', {
          signalId: sig.id,
          pair: sig.pair,
          error: e.message,
        });
      }

      if (execError) {
        await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
          status: 'rejected', rejection_reason: `exec_error:${execError}`,
        });
        
        await logSignalRejected(base44, sig, [`exec_error:${execError}`], { userId: user.id, requestId });
        
        results.push({ signal_id: sig.id, decision: 'error', error: execError });
        continue;
      }

      // Record trade
      const buyFill = execResult.fills.buy;
      const sellFill = execResult.fills.sell;
      const qty = buyFill?.qty || sellFill?.qty || 0;
      const grossSpread = (sellFill?.px || 0) - (buyFill?.px || 0);
      const notional = buyFill?.notional_usd || 0;

      const perLegBps = Number(config.taker_fee_bps_per_leg ?? 2);
      const perLegFeeRate = perLegBps / 10000;
      const perLegFee = notional * perLegFeeRate;
      const feeEst = perLegFee * 2;
      const slipEst = notional * (estimatedSlippageBpsEnhanced(sizeUsd, Number(sig.fillable_size_usd || 0)) / 10000);
      const basisPnl = qty * grossSpread;
      const netPnl = basisPnl - feeEst - slipEst;

      const buyVenueRaw = String(sig.buy_exchange || '');
      const sellVenueRaw = String(sig.sell_exchange || '');
      const buyIsSpot = /spot/i.test(buyVenueRaw);
      const buyIsPerp = /perp|swap|futures/i.test(buyVenueRaw);
      const sellIsSpot = /spot/i.test(sellVenueRaw);
      const sellIsPerp = /perp|swap|futures/i.test(sellVenueRaw);
      const rootOf = (v) => v.replace(/-(spot|perp|swap|futures)$/i, '').trim();
      const buyRoot = rootOf(buyVenueRaw);
      const sellRoot = rootOf(sellVenueRaw);

      let strategy;
      let spotExchange = buyRoot || sellRoot;
      let perpExchange = sellRoot || buyRoot;
      let spotEntryPx = buyFill?.px, spotExitPx = sellFill?.px;
      let perpEntryPx = null, perpExitPx = null;
      let spotEntryFee = perLegFee, spotExitFee = perLegFee;
      let perpEntryFee = null, perpExitFee = null;

      if ((buyIsSpot || buyIsPerp) && (sellIsSpot || sellIsPerp) && buyRoot === sellRoot) {
        strategy = 'Same-venue Spot/Perp Carry';
        spotExchange = buyRoot; perpExchange = buyRoot;
        if (buyIsSpot && sellIsPerp) {
          spotEntryPx = buyFill?.px; perpEntryPx = sellFill?.px;
          spotEntryFee = perLegFee; perpEntryFee = perLegFee;
          spotExitFee = perLegFee; perpExitFee = perLegFee;
          spotExitPx = null; perpExitPx = null;
        } else if (buyIsPerp && sellIsSpot) {
          perpEntryPx = buyFill?.px; spotEntryPx = sellFill?.px;
          perpEntryFee = perLegFee; spotEntryFee = perLegFee;
          spotExitFee = perLegFee; perpExitFee = perLegFee;
          spotExitPx = null; perpExitPx = null;
        }
      } else if (buyIsPerp && sellIsPerp) {
        strategy = 'Cross-venue Perp/Perp';
        perpExchange = `${buyRoot}/${sellRoot}`; spotExchange = null;
        perpEntryPx = buyFill?.px; perpExitPx = sellFill?.px;
        perpEntryFee = perLegFee; perpExitFee = perLegFee;
        spotEntryPx = null; spotExitPx = null; spotEntryFee = null; spotExitFee = null;
      } else {
        strategy = 'Cross-venue Spot Spread';
        spotExchange = `${buyRoot}/${sellRoot}`; perpExchange = null;
      }

      const tradeIdSuffix = `${Date.now().toString(36)}-${tradeCounter++}`;
      const directionLabel = strategy === 'Same-venue Spot/Perp Carry'
        ? (buyIsSpot ? `Long ${buyRoot} spot / Short ${buyRoot} perp` : `Long ${buyRoot} perp / Short ${buyRoot} spot`)
        : `Buy ${buyVenueRaw} / Sell ${sellVenueRaw}`;

      const trade = await base44.asServiceRole.entities.ArbTrade.create({
        trade_id: `AUTO-${tradeIdSuffix}`,
        trade_date: todayStr,
        entry_timestamp: new Date().toISOString(),
        exit_timestamp: new Date().toISOString(),
        status: 'Closed',
        strategy,
        asset: sig.asset || 'Other',
        spot_exchange: spotExchange,
        perp_exchange: perpExchange,
        direction: directionLabel,
        spot_entry_px: spotEntryPx, spot_exit_px: spotExitPx,
        perp_entry_px: perpEntryPx, perp_exit_px: perpExitPx,
        spot_qty: qty, perp_qty: perpEntryPx ? qty : null,
        gross_spread_entry: grossSpread,
        entry_spread_bps: Number(sig.raw_spread_bps || 0),
        exit_spread_bps: 0,
        spot_entry_fee: spotEntryFee, spot_exit_fee: spotExitFee,
        perp_entry_fee: perpEntryFee, perp_exit_fee: perpExitFee,
        expected_slippage: slipEst,
        realized_slippage: slipEst,
        total_realized_fees: feeEst + slipEst,
        basis_pnl: basisPnl,
        net_pnl: netPnl,
        net_pnl_bps: notional > 0 ? (netPnl / notional) * 10000 : 0,
        allocated_capital: notional,
        entry_order_type: 'Market', exit_order_type: 'Market',
        entry_fee_type: 'Taker', exit_fee_type: 'Taker',
        entry_thesis: `Auto-executed signal ${sig.id} | net=${gates.recomputedNetBps?.toFixed(2)}bps | confidence=${confidence}% | condition=${condition} | ${sig.notes || ''}`.trim(),
        mode: execResult.mode === 'paper' ? 'paper' : 'live',
      });

      await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
        status: 'executed',
        executed_pnl_bps: trade.net_pnl_bps,
        executed_pnl_usd: netPnl,
        win: netPnl > 0,
        notes: `trade=${trade.trade_id} confidence=${confidence}% condition=${condition}`,
      });

      // ENHANCED: Log trade execution
      await logTradeExecution(base44, trade, {
        signalId: sig.id,
        executionMode: execResult.mode,
        userId: user.id,
        requestId,
      });

      reservedAssets.add(sig.asset);
      results.push({
        signal_id: sig.id, pair: sig.pair,
        decision: 'executed', mode: execResult.mode,
        trade_id: trade.trade_id, size_usd: Math.round(notional),
        net_pnl_usd: Number(netPnl.toFixed(2)),
        confidence, condition,
        recomputed_net_bps: gates.recomputedNetBps,
      });
    }

    const responseData = {
      ok: true,
      dry_run: dryRun,
      paper_trading: config.paper_trading !== false,
      batch_mode: isBatchMode,
      batch_threshold: batchThreshold,
      candidates_received: candidates.length,
      candidates_processed: toProcess.length,
      processed: results.length,
      executed: results.filter(r => r.decision === 'executed').length,
      rejected: results.filter(r => r.decision === 'rejected').length,
      expired: expiredIds.length,
      expired_signals: expiredIds.slice(0, 10),
      results,
    };

    // Add rate limit headers
    const rateLimitHeaders = await getRateLimitHeaders(base44, req, 'executeSignals');

    return Response.json(responseData, {
      headers: rateLimitHeaders,
    });

  } catch (error) {
    console.error('executeSignals error:', error);
    
    // Log error
    try {
      const base44 = createClientFromRequest(req);
      await logApiError(base44, error, 'executeSignals', {
        requestId,
        endpoint: 'executeSignals',
      });
    } catch {
      // If logging fails, just continue
    }
    
    return Response.json({ error: error.message, requestId }, { status: 500 });
  }
});
