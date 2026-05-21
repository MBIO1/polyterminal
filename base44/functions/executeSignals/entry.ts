// executeSignals — Production-grade state-machine execution engine
//
// MODULE 1: Production-grade order normalization (BTC/ETH only)
// MODULE 2: State-machine execution with circuit breakers + retry/backoff
// MODULE 3: Full latency instrumentation stored to ExecLatencyMetric entity
//
// STATES: VALIDATED → ORDER_SENT → ACK_RECEIVED → FILLED | PARTIAL_FILL | FAILED | TIMED_OUT

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Constants ────────────────────────────────────────────────────────────────

// ── POLYTERMINAL LIVE CONFIG (synced from ARB_CONFIG) ────────────────────────
const DEFAULT_MIN_EDGE       = 18.0;     // minRealEdgePct: 0.18% = 18 bps
const FEE_BPS_PER_LEG        = 5.5;     // takerPct: 0.055% per leg
const MAX_LIVE_NOTIONAL_USD  = 20;      // sizing.maxNotionalUsd
const MIN_NOTIONAL_USD       = 15;      // sizing.minNotionalUsd
const MIN_CONFIDENCE         = 85;      // signal.minConfidenceScore: 0.85
const EXEC_TIMEOUT_MS        = 5_000;   // execution.timeoutMs
const HARD_STALE_MS          = 20_000;  // signal.hardStaleMs

// Circuit breaker thresholds
const CB_FAILURE_THRESHOLD   = 3;        // circuitBreakers.consecutiveHttp500
const CB_HALF_OPEN_AFTER_MS  = 900_000;  // circuitBreakers.cooldownMs (15 min)
const CB_SUCCESS_TO_CLOSE    = 2;        // consecutive successes to close

// Retry config: 2 attempts with [500ms, 1200ms] backoff (execution.retry)
const RETRY_DELAYS_MS        = [500, 1200]; // attempts 1,2

// ── FOCUSED PAIRS: BTC and ETH only ──────────────────────────────────────────
const ALLOWED_ASSETS = new Set(['BTC', 'ETH']);

// MODULE 1 — Production-grade exchange normalization specs
// tickSize for price rounding; qtyStep + minQty + minNotionalUsd for order sizing
const EXCHANGE_SPECS = {
  BTC: {
    tickSize:      0.01,    // price precision: $X.XX
    qtyStep:       0.000001,
    minQty:        0.000048,
    minNotionalUsd: 1,       // Bybit unified min
    pricePrecision: 2,
    qtyPrecision:  6,
  },
  ETH: {
    tickSize:      0.01,
    qtyStep:       0.0001,
    minQty:        0.000458,
    minNotionalUsd: 1,
    pricePrecision: 2,
    qtyPrecision:  4,
  },
};

// ─── Typed error codes ────────────────────────────────────────────────────────

const ERR = {
  ASSET_NOT_ALLOWED:        'ASSET_NOT_ALLOWED',
  MISSING_PRICE:            'MISSING_PRICE',
  MIN_QTY_VIOLATION:        'MIN_QTY_VIOLATION',
  MIN_NOTIONAL_VIOLATION:   'MIN_NOTIONAL_VIOLATION',
  CAPITAL_CAP_EXCEEDED:     'CAPITAL_CAP_EXCEEDED',
  INSUFFICIENT_LIQUIDITY:   'INSUFFICIENT_LIQUIDITY',
  STALE_SIGNAL:             'STALE_SIGNAL',
  CAPITAL_SIZE_ZERO:        'CAPITAL_SIZE_ZERO',
  LOW_EDGE:                 'LOW_EDGE',
  CIRCUIT_OPEN:             'CIRCUIT_OPEN',
  EXEC_TIMEOUT:             'EXEC_TIMEOUT',
  EXEC_FAILED:              'EXEC_FAILED',
  PARTIAL_FILL:             'PARTIAL_FILL',
};

// ─── Structured logger ────────────────────────────────────────────────────────

function log(level, module, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, module, msg, ...meta };
  if (level === 'ERROR') console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

// ─── MODULE 1: Order normalization ───────────────────────────────────────────

function decimalsFromStep(step) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function floorToStep(value, step) {
  const decimals = decimalsFromStep(step);
  return Number((Math.floor(value / step + 1e-12) * step).toFixed(decimals));
}

function roundToTickSize(price, tickSize, precision) {
  const rounded = Math.round(price / tickSize) * tickSize;
  return Number(rounded.toFixed(precision));
}

/**
 * normalizeOrder — MODULE 1 core.
 * Returns { ok, order } or { ok: false, errorCode, reason }
 * Validates: minQty, minNotional, stepSize, price tickSize, capital cap.
 */
function normalizeOrder(asset, rawQty, buyPrice, sellPrice, targetNotionalUsd, maxSpendUsd) {
  const spec = EXCHANGE_SPECS[asset];
  if (!spec) return { ok: false, errorCode: ERR.ASSET_NOT_ALLOWED, reason: `${asset} not in allowed pair set [BTC, ETH]` };
  if (!buyPrice || !sellPrice) return { ok: false, errorCode: ERR.MISSING_PRICE, reason: 'buy_price or sell_price is zero/missing' };

  // Normalize prices to tick size
  const normBuyPrice  = roundToTickSize(buyPrice,  spec.tickSize, spec.pricePrecision);
  const normSellPrice = roundToTickSize(sellPrice, spec.tickSize, spec.pricePrecision);
  const refPrice      = normBuyPrice;

  // Compute qty from target notional, then floor to step
  const rawQtyFromNotional = Math.max(rawQty, targetNotionalUsd / refPrice);
  const steppedQty         = floorToStep(rawQtyFromNotional, spec.qtyStep);

  // minQty validation
  if (steppedQty < spec.minQty) {
    return {
      ok: false,
      errorCode: ERR.MIN_QTY_VIOLATION,
      reason: `qty ${steppedQty} < minQty ${spec.minQty} for ${asset}`,
    };
  }

  const normalizedNotional = steppedQty * refPrice;

  // minNotional validation
  if (normalizedNotional < spec.minNotionalUsd) {
    return {
      ok: false,
      errorCode: ERR.MIN_NOTIONAL_VIOLATION,
      reason: `notional $${normalizedNotional.toFixed(4)} < minNotional $${spec.minNotionalUsd} for ${asset}`,
    };
  }

  // Capital cap
  if (normalizedNotional > maxSpendUsd) {
    return {
      ok: false,
      errorCode: ERR.CAPITAL_CAP_EXCEEDED,
      reason: `notional $${normalizedNotional.toFixed(2)} > spendCap $${maxSpendUsd.toFixed(2)}`,
    };
  }

  return {
    ok: true,
    order: {
      qty:             steppedQty,
      qtyStr:          steppedQty.toFixed(spec.qtyPrecision),
      sizeUsd:         normalizedNotional,
      normBuyPrice,
      normSellPrice,
      spec,
    },
  };
}

// ─── MODULE 2: Circuit breaker ────────────────────────────────────────────────

// In-memory circuit state (survives within a single function invocation batch).
// Persistent state is backed by PairCircuitBreaker entity.
const _cbCache = new Map(); // pair → { state, failures, successes, openedAt }

async function loadCircuitBreaker(base44, pair) {
  if (_cbCache.has(pair)) return _cbCache.get(pair);
  const records = await base44.asServiceRole.entities.PairCircuitBreaker.filter({ pair }, '-created_date', 1);
  const rec = records?.[0];
  const cb = rec
    ? { id: rec.id, state: rec.state, failures: rec.failure_count, successes: rec.success_count, openedAt: rec.opened_at ? new Date(rec.opened_at).getTime() : null, nextRetryAt: rec.next_retry_at ? new Date(rec.next_retry_at).getTime() : null }
    : { id: null, state: 'CLOSED', failures: 0, successes: 0, openedAt: null, nextRetryAt: null };
  _cbCache.set(pair, cb);
  return cb;
}

async function saveCircuitBreaker(base44, pair, asset, cb, lastError = null) {
  const now = new Date().toISOString();
  const data = {
    pair, asset,
    state: cb.state,
    failure_count: cb.failures,
    success_count: cb.successes,
    opened_at: cb.openedAt ? new Date(cb.openedAt).toISOString() : null,
    next_retry_at: cb.nextRetryAt ? new Date(cb.nextRetryAt).toISOString() : null,
    last_error: lastError ? String(lastError).slice(0, 200) : null,
    health_score: Math.max(0, 100 - cb.failures * 20),
  };
  if (cb.id) {
    await base44.asServiceRole.entities.PairCircuitBreaker.update(cb.id, data).catch(e => log('ERROR', 'CB', 'save failed', { error: e.message }));
  } else {
    const rec = await base44.asServiceRole.entities.PairCircuitBreaker.create(data).catch(e => { log('ERROR', 'CB', 'create failed', { error: e.message }); return null; });
    if (rec) cb.id = rec.id;
  }
  _cbCache.set(pair, cb);
}

function isCircuitOpen(cb) {
  if (cb.state === 'CLOSED') return false;
  if (cb.state === 'OPEN') {
    // Allow HALF_OPEN probe if enough time has passed
    if (cb.nextRetryAt && Date.now() >= cb.nextRetryAt) {
      cb.state = 'HALF_OPEN';
      return false;
    }
    return true;
  }
  return false; // HALF_OPEN = allow one trial
}

async function recordSuccess(base44, pair, asset, cb) {
  cb.successes += 1;
  cb.failures = 0;
  if (cb.state === 'HALF_OPEN' && cb.successes >= CB_SUCCESS_TO_CLOSE) {
    cb.state = 'CLOSED';
    log('INFO', 'CB', `Circuit CLOSED for ${pair} after ${cb.successes} successes`);
  }
  await saveCircuitBreaker(base44, pair, asset, cb);
}

async function recordFailure(base44, pair, asset, cb, errorMsg) {
  cb.failures += 1;
  cb.successes = 0;
  if (cb.failures >= CB_FAILURE_THRESHOLD || cb.state === 'HALF_OPEN') {
    cb.state = 'OPEN';
    cb.openedAt = Date.now();
    cb.nextRetryAt = Date.now() + CB_HALF_OPEN_AFTER_MS;
    log('ERROR', 'CB', `Circuit OPENED for ${pair} after ${cb.failures} failures`, { error: errorMsg });
  }
  await saveCircuitBreaker(base44, pair, asset, cb, errorMsg);
}

// ─── MODULE 2: Execution state machine ───────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function executeWithStateMachine(signal, qty, dropletIp, dropletSecret, port) {
  const url      = `http://${dropletIp}:${port}/execute`;
  const payload  = {
    signal_id:     signal.id,
    pair:          signal.pair,
    asset:         signal.asset,
    buy_exchange:  signal.buy_exchange,
    sell_exchange: signal.sell_exchange,
    buy_price:     signal.buy_price,
    sell_price:    signal.sell_price,
    net_edge_bps:  signal.net_edge_bps,
    qty,
  };

  let state = 'ORDER_SENT';
  const orderSentAt = Date.now();

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    log('INFO', 'SM', `Attempt ${attempt + 1}/${RETRY_DELAYS_MS.length} state=${state}`, { pair: signal.pair, qty });

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), EXEC_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dropletSecret}` },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw { code: `droplet_http_${res.status}`, msg: errText.slice(0, 120) };
      }

      state = 'ACK_RECEIVED';
      const ackAt  = Date.now();
      const json   = await res.json().catch(() => { throw { code: 'INVALID_RESPONSE', msg: 'non-json from droplet' }; });

      if (!json.ok) throw { code: ERR.EXEC_FAILED, msg: json.error || 'droplet returned ok=false' };

      state = json.spotOk && json.perpOk ? 'FILLED' : 'PARTIAL_FILL';

      log('INFO', 'SM', `State → ${state}`, { pair: signal.pair, orderSentAt, ackAt, ackLatencyMs: ackAt - orderSentAt });

      return {
        state,
        result:     json,
        orderSentAt,
        ackAt,
        fillAt:     Date.now(),
        retryCount: attempt,
      };

    } catch (err) {
      clearTimeout(timeout);
      const isTimeout  = err?.name === 'AbortError' || err?.code === 'EXEC_TIMEOUT';
      const errCode    = isTimeout ? ERR.EXEC_TIMEOUT : (err?.code || ERR.EXEC_FAILED);
      const errMsg     = isTimeout ? 'timeout' : (err?.msg || err?.message || 'unknown');

      log('ERROR', 'SM', `Attempt ${attempt + 1} failed state=${state}`, { pair: signal.pair, code: errCode, error: errMsg });

      if (attempt < RETRY_DELAYS_MS.length - 1) {
        const delay = RETRY_DELAYS_MS[attempt + 1];
        log('INFO', 'SM', `Backoff ${delay}ms before retry`, { pair: signal.pair });
        await sleep(delay);
      } else {
        return { state: isTimeout ? 'TIMED_OUT' : 'FAILED', errorCode: errCode, errorMsg, orderSentAt, ackAt: null, fillAt: null, retryCount: attempt };
      }
    }
  }

  return { state: 'FAILED', errorCode: ERR.EXEC_FAILED, errorMsg: 'all_retries_exhausted', orderSentAt, ackAt: null, fillAt: null, retryCount: RETRY_DELAYS_MS.length };
}

// ─── MODULE 3: Latency metric recorder ───────────────────────────────────────

async function recordLatencyMetric(base44, signal, execOutcome, validationStart, validationEnd, mode) {
  const detectedAt  = signal.signal_time  ? new Date(signal.signal_time).getTime()  : null;
  const receivedAt  = signal.received_time ? new Date(signal.received_time).getTime() : null;
  const fillAt      = execOutcome.fillAt  || null;
  const ackAt       = execOutcome.ackAt   || null;
  const sentAt      = execOutcome.orderSentAt || null;

  const metric = {
    signal_id:                   signal.id,
    pair:                        signal.pair,
    asset:                       signal.asset || signal.pair?.split('-')[0],
    mode,
    signal_detected_at:          signal.signal_time || null,
    signal_received_at:          signal.received_time || null,
    validation_start_at:         new Date(validationStart).toISOString(),
    validation_end_at:           new Date(validationEnd).toISOString(),
    order_sent_at:               sentAt   ? new Date(sentAt).toISOString()  : null,
    order_ack_at:                ackAt    ? new Date(ackAt).toISOString()   : null,
    fill_confirmed_at:           fillAt   ? new Date(fillAt).toISOString()  : null,
    signal_detection_latency_ms: (detectedAt && receivedAt) ? receivedAt - detectedAt : null,
    validation_latency_ms:       validationEnd - validationStart,
    order_send_latency_ms:       (sentAt && ackAt) ? ackAt - sentAt : null,
    fill_latency_ms:             (ackAt && fillAt) ? fillAt - ackAt : null,
    total_execution_latency_ms:  (detectedAt && fillAt) ? fillAt - detectedAt : (sentAt && fillAt) ? fillAt - sentAt : null,
    execution_state:             execOutcome.state,
    retry_count:                 execOutcome.retryCount || 0,
    circuit_breaker_triggered:   execOutcome.state === 'CIRCUIT_OPEN',
    health_score:                computeExecHealthScore(execOutcome),
    error_code:                  execOutcome.errorCode || null,
    notes:                       execOutcome.errorMsg ? execOutcome.errorMsg.slice(0, 200) : null,
  };

  await base44.asServiceRole.entities.ExecLatencyMetric.create(metric)
    .catch(e => log('ERROR', 'LATENCY', 'Failed to record metric', { error: e.message }));
}

function computeExecHealthScore(outcome) {
  if (outcome.state === 'FILLED') {
    const latency = outcome.fillAt && outcome.orderSentAt ? outcome.fillAt - outcome.orderSentAt : 0;
    const latencyScore = latency < 500 ? 100 : latency < 1000 ? 85 : latency < 3000 ? 70 : latency < 8000 ? 50 : 30;
    const retryPenalty = (outcome.retryCount || 0) * 15;
    return Math.max(0, latencyScore - retryPenalty);
  }
  if (outcome.state === 'PARTIAL_FILL') return 30;
  if (outcome.state === 'TIMED_OUT')    return 10;
  if (outcome.state === 'CIRCUIT_OPEN') return 0;
  return 0;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signalAgeMs(signal) {
  return Date.now() - new Date(signal.received_time || signal.created_date).getTime();
}

function signalConfidence(signal, ttlMs) {
  const ageFraction    = Math.min(signalAgeMs(signal) / ttlMs, 1);
  const agePts         = 50 * (1 - ageFraction);
  const confirmed      = Number(signal.confirmed_exchanges || 1);
  const confirmPts     = confirmed >= 3 ? 40 : confirmed >= 2 ? 30 : 15;
  const fillable       = Number(signal.fillable_size_usd || 0);
  const fillPts        = Math.min(fillable / 1000, 1) * 10;
  const ageMs          = signalAgeMs(signal);
  const freshnessBonus = ageMs < 1000 ? 20 : ageMs < 5000 ? 10 : 0;
  return Math.min(100, Math.max(0, Math.round(agePts + confirmPts + fillPts + freshnessBonus)));
}

function sizeMultiplier(confidence) {
  if (confidence >= 80) return 1.00;
  if (confidence >= 60) return 0.50;
  if (confidence >= 40) return 0.25;
  return 0;
}

function recomputeNetEdge(signal, config, sizeUsd) {
  const rawBps   = Math.max(-1000, Math.min(1000, Number(signal.raw_spread_bps || 0)));
  const takerBps = Math.max(0, Math.min(100, Number(config.taker_fee_bps_per_leg ?? FEE_BPS_PER_LEG)));
  const fillable = Math.max(1, Number(signal.fillable_size_usd || 1));
  const sizeRatio= Math.min(Math.max(0, sizeUsd) / fillable, 1);
  const slipBps  = sizeRatio < 0.1 ? 0.5 : sizeRatio < 0.3 ? 1 : sizeRatio < 0.6 ? 1.5 : 2;
  const quotedNet= signal.net_edge_bps != null ? Number(signal.net_edge_bps) : rawBps - (4 * takerBps);
  const net      = quotedNet - slipBps;
  return { rawBps, takerBps, slipBps, net };
}

function computeSizeUsd(signal, config, confidence, capitalFlowUsd, profitGrowthUsd = 0) {
  const configuredCap = Number(config.total_capital || 0);
  const capitalBase   = capitalFlowUsd > 0 ? capitalFlowUsd : configuredCap * Number(config.spot_allocation_pct || 0.35);
  const growthBoost   = Math.min(Math.max(Number(profitGrowthUsd || 0), 0) / 100, 0.15);
  const basePct       = capitalBase < 50 ? 0.25 : capitalBase < 250 ? 0.18 : 0.10;
  const perTradePct   = Math.min(basePct + growthBoost, 0.30);
  const perTradeCap   = capitalBase * perTradePct;
  const fillable      = Number(signal.fillable_size_usd || 0);
  const minExecutable = Math.max(5, Number(config.min_fillable_usd || 5));
  const mult          = sizeMultiplier(confidence);
  if (mult <= 0 || fillable < minExecutable || capitalBase < 5) return 0;
  const riskSize = Math.min(perTradeCap, fillable * 0.20, capitalBase * 0.85) * mult;
  return Math.min(Math.max(5, Math.floor(riskSize)), fillable, MAX_LIVE_NOTIONAL_USD, capitalBase * 0.85);
}

async function fetchAvailableCapitalUsd(dropletIp, secret, port) {
  if (!dropletIp || !secret) return null;
  for (const path of ['/api/balance', '/balance']) {
    try {
      const r = await fetch(`http://${dropletIp}:${port}${path}`, {
        headers: { 'X-Droplet-Secret': secret, 'Authorization': `Bearer ${secret}` },
        signal:  AbortSignal.timeout(5000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      const available = Number(d.totalAvailableBalance || d.availableBalance || 0);
      const equity    = Number(d.totalEquity || 0);
      return available > 0 ? available : equity > 0 ? equity : null;
    } catch (_) {}
  }
  return null;
}

function paperFill(signal, sizeUsd) {
  const buyPx  = Number(signal.buy_price)  || 0;
  const sellPx = Number(signal.sell_price) || 0;
  if (!buyPx || !sellPx) throw new Error('missing prices in signal');
  const qty = Number((sizeUsd / buyPx).toFixed(8));
  return { state: 'FILLED', result: { spotOk: true, perpOk: true, mode: 'paper' }, orderSentAt: Date.now(), ackAt: Date.now(), fillAt: Date.now(), retryCount: 0 };
}

async function activateKillSwitch(base44, configId, pair) {
  await base44.asServiceRole.entities.ArbConfig.update(configId, { kill_switch_active: true })
    .catch(e => log('ERROR', 'KS', 'kill-switch activation failed', { error: e.message }));
  log('ERROR', 'KS', `Kill-switch activated due to partial fill on ${pair}`);
}

async function sendPartialFillAlert(pair, trade, d, qty) {
  const tgToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const tgChat  = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!tgToken || !tgChat) return;
  const filledLeg  = d.spotOk ? 'spot' : 'perp';
  const missingLeg = d.spotOk ? 'perp' : 'spot';
  const orderId    = d.spotOk ? d.spotOrderId : d.perpOrderId;
  const msg = `🚨🚨 PARTIAL FILL — NAKED ${missingLeg.toUpperCase()} EXPOSURE\n\nTrade: ${trade.trade_id}\nPair: ${pair}\nFilled: ${filledLeg} (${orderId})\nMissing: ${missingLeg}\nQty: ${qty}\n\n⛔ Kill-switch ACTIVATED.`;
  await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: tgChat, text: msg }),
    signal: AbortSignal.timeout(5000),
  }).catch(e => log('ERROR', 'TG', 'partial fill alert failed', { error: e.message }));
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body   = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

    const internalSecret = String(body.internal_secret || '');
    const expectedSecret = Deno.env.get('BOT_SECRET') || Deno.env.get('DROPLET_SECRET') || '';
    const isInternal     = !!internalSecret && internalSecret === expectedSecret;
    if (!isInternal) {
      let user = null;
      try { user = await base44.auth.me(); } catch {}
      if (!user)              return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const dryRun     = body.dry_run === true;
    const forceId    = body.signal_id || null;
    const ttlMs      = Number(body.signal_ttl_ms) || 60_000;
    const maxSignals = Math.min(Number(body.max_signals) || 10, 25);

    const dropletIp     = Deno.env.get('DROPLET_IP');
    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const port          = Deno.env.get('ORDER_SERVER_PORT') || '4001';

    // ── Load config ──────────────────────────────────────────────────────────
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config  = configs?.[0];
    if (!config) return Response.json({ error: 'No ArbConfig found' }, { status: 400 });

    if (config.kill_switch_active)       return Response.json({ ok: false, halted: true, reason: 'kill_switch_active' });
    if (!config.bot_running && !forceId) return Response.json({ ok: false, halted: true, reason: 'bot_not_running' });

    const minEdge = Math.max(3, Number(config.btc_min_edge_bps ?? DEFAULT_MIN_EDGE));

    // ── Load signals ─────────────────────────────────────────────────────────
    const nowTs    = Date.now();
    const todayStr = new Date().toISOString().slice(0, 10);
    const recentAll = await base44.asServiceRole.entities.ArbSignal.filter(
      { status: { $in: ['detected', 'alerted'] } }, '-received_time', 100
    );

    const expiredIds = [], hardStaleIds = [];
    let candidates;

    if (forceId) {
      const found = recentAll.find(s => s.id === forceId);
      if (!found) return Response.json({ error: `Signal ${forceId} not found` }, { status: 404 });
      candidates = [found];
      for (const s of recentAll) {
        if (s.id === forceId) continue;
        if (nowTs - new Date(s.received_time || s.created_date).getTime() > HARD_STALE_MS) hardStaleIds.push(s.id);
      }
    } else {
      const fresh = [];
      for (const s of recentAll) {
        const age = nowTs - new Date(s.received_time || s.created_date).getTime();
        if (age > HARD_STALE_MS) hardStaleIds.push(s.id);
        else if (age > ttlMs)    expiredIds.push(s.id);
        else                     fresh.push(s);
      }
      candidates = fresh.slice(0, maxSignals);
    }

    if (!dryRun && (expiredIds.length + hardStaleIds.length) > 0) {
      await Promise.all([
        ...expiredIds.map(id => base44.asServiceRole.entities.ArbSignal.update(id, { status: 'expired', rejection_reason: 'ttl_exceeded' }).catch(() => {})),
        ...hardStaleIds.map(id => base44.asServiceRole.entities.ArbSignal.update(id, { status: 'expired', rejection_reason: 'hard_stale_5min' }).catch(() => {})),
      ]);
    }

    // ── Risk gates ────────────────────────────────────────────────────────────
    const [closedToday, openPositions, recentClosedTrades, liveCapital] = await Promise.all([
      base44.asServiceRole.entities.ArbTrade.filter({ status: 'Closed', trade_date: todayStr }, '-updated_date', 200),
      base44.asServiceRole.entities.ArbLivePosition.filter({ status: 'Open' }, '-snapshot_time', 50),
      base44.asServiceRole.entities.ArbTrade.filter({ status: 'Closed' }, '-trade_date', 200),
      fetchAvailableCapitalUsd(dropletIp, dropletSecret, port),
    ]);

    const totalCap          = Number(config.total_capital || 0);
    const todayPnl          = closedToday.reduce((a, t) => a + Number(t.net_pnl || 0), 0);
    const realizedProfit    = recentClosedTrades.reduce((a, t) => a + Math.max(Number(t.net_pnl || 0), 0), 0);
    const capitalFlowUsd    = liveCapital || totalCap * Number(config.spot_allocation_pct || 0.35);
    const ddCap             = totalCap * Number(config.max_daily_drawdown_pct || 0.01);

    if (todayPnl < -ddCap) return Response.json({ ok: false, halted: true, reason: `daily_drawdown_breach(${todayPnl.toFixed(2)})` });

    const perpBucket    = totalCap * Number(config.perp_collateral_pct || 0.245);
    const marginUsed    = openPositions.reduce((a, p) => a + Number(p.margin_used || 0), 0);
    const marginUtil    = perpBucket > 0 ? marginUsed / perpBucket : 0;
    const maxMarginUtil = Number(config.max_margin_utilization_pct || 0.35);
    if (marginUtil >= maxMarginUtil) return Response.json({ ok: false, halted: true, reason: `margin_util_breach(${(marginUtil*100).toFixed(1)}%)` });

    // ── Score & filter: BTC/ETH only ─────────────────────────────────────────
    const scored = [];

    for (const sig of candidates) {
      const validationStart = Date.now();

      // PAIR FILTER — BTC and ETH only
      const asset = String(sig.asset || sig.pair?.split('-')[0] || '').toUpperCase();
      if (!ALLOWED_ASSETS.has(asset) && !forceId) {
        log('INFO', 'FILTER', `SKIP ${sig.pair}: asset ${asset} not in allowed set`);
        continue;
      }

      const confidence = signalConfidence(sig, ttlMs);
      if (confidence < MIN_CONFIDENCE && !forceId) {
        log('INFO', 'FILTER', `REJECT ${sig.pair}: confidence=${confidence} < ${MIN_CONFIDENCE}`);
        continue;
      }

      if (signalAgeMs(sig) > 60_000 && !forceId) {
        log('INFO', 'FILTER', `REJECT ${sig.pair}: STALE_SIGNAL`);
        if (!dryRun) await base44.asServiceRole.entities.ArbSignal.update(sig.id, { status: 'rejected', rejection_reason: ERR.STALE_SIGNAL }).catch(() => {});
        continue;
      }

      const initialSizeUsd = computeSizeUsd(sig, config, confidence, capitalFlowUsd, realizedProfit);
      if (initialSizeUsd <= 0) {
        log('INFO', 'FILTER', `REJECT ${sig.pair}: CAPITAL_SIZE_ZERO`);
        if (!dryRun) await base44.asServiceRole.entities.ArbSignal.update(sig.id, { status: 'rejected', rejection_reason: ERR.CAPITAL_SIZE_ZERO }).catch(() => {});
        continue;
      }

      const maxSpendUsd  = Math.min(capitalFlowUsd * 0.85, MAX_LIVE_NOTIONAL_USD);
      const buyPx        = Number(sig.buy_price) || 0;
      const sellPx       = Number(sig.sell_price) || 0;
      const rawQty       = buyPx > 0 ? initialSizeUsd / buyPx : 0;

      // MODULE 1 normalization
      const normResult = normalizeOrder(asset, rawQty, buyPx, sellPx, initialSizeUsd, maxSpendUsd);
      if (!normResult.ok) {
        log('INFO', 'NORM', `REJECT ${sig.pair}: ${normResult.errorCode} — ${normResult.reason}`);
        if (!dryRun) await base44.asServiceRole.entities.ArbSignal.update(sig.id, { status: 'rejected', rejection_reason: `${normResult.errorCode}: ${normResult.reason}` }).catch(() => {});
        continue;
      }

      const { sizeUsd, qty } = normResult.order;

      const fillable = Number(sig.fillable_size_usd || 0);
      if (fillable < Math.max(sizeUsd, Number(config.min_fillable_usd || MIN_NOTIONAL_USD)) && !forceId) {
        log('INFO', 'FILTER', `REJECT ${sig.pair}: INSUFFICIENT_LIQUIDITY fillable=$${fillable} need=$${sizeUsd}`);
        if (!dryRun) await base44.asServiceRole.entities.ArbSignal.update(sig.id, { status: 'rejected', rejection_reason: ERR.INSUFFICIENT_LIQUIDITY }).catch(() => {});
        continue;
      }

      const { rawBps, takerBps, slipBps, net } = recomputeNetEdge(sig, config, sizeUsd);
      const expectedProfit = sizeUsd * (net / 10000);
      if ((net < minEdge || expectedProfit < 0.01) && !forceId) {
        log('INFO', 'FILTER', `SKIP ${sig.pair}: LOW_EDGE net=${net.toFixed(2)}bps expected=$${expectedProfit.toFixed(4)}`);
        continue;
      }

      const validationEnd = Date.now();
      log('INFO', 'ACCEPT', `${sig.pair} net=${net.toFixed(2)}bps size=$${sizeUsd.toFixed(2)} qty=${qty} conf=${confidence} validationMs=${validationEnd - validationStart}`);
      scored.push({ sig, asset, confidence, sizeUsd, qty, net, rawBps, takerBps, slipBps, validationStart, validationEnd });
    }

    // Best edge first, one trade per asset
    scored.sort((a, b) => b.net - a.net);
    const seenAssets = new Set();
    const toExecute  = [];
    for (const s of scored) {
      if (seenAssets.has(s.sig.asset)) continue;
      seenAssets.add(s.sig.asset);
      toExecute.push(s);
    }

    // ── Max concurrent trades gate (ARB_CONFIG: maxConcurrentTrades = 1) ────
    const MAX_CONCURRENT_TRADES = 1;
    const openTradeCount = openPositions.length;
    if (openTradeCount >= MAX_CONCURRENT_TRADES && !forceId) {
      log('INFO', 'GATE', `Max concurrent trades reached (${openTradeCount}/${MAX_CONCURRENT_TRADES}) — skipping execution`);
      return Response.json({ ok: true, halted: true, reason: `max_concurrent_trades(${openTradeCount})`, results: [] });
    }

    // ── Execute ───────────────────────────────────────────────────────────────
    const results    = [];
    let tradeCounter = 1;

    for (const { sig, asset, confidence, sizeUsd, qty, net, rawBps, takerBps, slipBps, validationStart, validationEnd } of toExecute) {
      const condition = confidence >= 80 ? 'HEALTHY' : confidence >= 60 ? 'VOLATILE' : 'UNCERTAIN';

      if (dryRun) {
        results.push({ signal_id: sig.id, pair: sig.pair, decision: 'would_execute', size_usd: sizeUsd, confidence, condition, net_bps: net });
        continue;
      }

      const buyPx  = Number(sig.buy_price)  || 0;
      const sellPx = Number(sig.sell_price) || 0;
      if (!buyPx) {
        results.push({ signal_id: sig.id, pair: sig.pair, decision: 'error', error: ERR.MISSING_PRICE });
        continue;
      }

      const isLive = !config.paper_trading;

      // MODULE 2 — Circuit breaker check
      const cb = await loadCircuitBreaker(base44, sig.pair);
      if (isCircuitOpen(cb) && !forceId) {
        log('WARN', 'CB', `CIRCUIT OPEN — skipping ${sig.pair}`, { state: cb.state, openedAt: cb.openedAt });
        await recordLatencyMetric(base44, sig, { state: 'CIRCUIT_OPEN', errorCode: ERR.CIRCUIT_OPEN, retryCount: 0 }, validationStart, validationEnd, isLive ? 'live' : 'paper');
        results.push({ signal_id: sig.id, pair: sig.pair, decision: 'circuit_open' });
        continue;
      }

      let execOutcome;
      try {
        if (isLive) {
          if (qty * buyPx > MAX_LIVE_NOTIONAL_USD) throw new Error(`hard_notional_cap: $${(qty * buyPx).toFixed(2)} > $${MAX_LIVE_NOTIONAL_USD}`);
          execOutcome = await executeWithStateMachine(sig, qty, dropletIp, dropletSecret, port);
        } else {
          execOutcome = paperFill(sig, sizeUsd);
        }
      } catch (e) {
        execOutcome = { state: 'FAILED', errorCode: ERR.EXEC_FAILED, errorMsg: e.message?.slice(0, 120), orderSentAt: Date.now(), ackAt: null, fillAt: null, retryCount: 0 };
      }

      // MODULE 2 — Update circuit breaker
      if (execOutcome.state === 'FILLED') {
        await recordSuccess(base44, sig.pair, asset, cb);
      } else if (['FAILED', 'TIMED_OUT'].includes(execOutcome.state)) {
        await recordFailure(base44, sig.pair, asset, cb, execOutcome.errorMsg);
      }

      // MODULE 3 — Record latency metric
      await recordLatencyMetric(base44, sig, execOutcome, validationStart, validationEnd, isLive ? 'live' : 'paper');

      if (!['FILLED', 'PARTIAL_FILL'].includes(execOutcome.state)) {
        const safeMsg = execOutcome.errorMsg || execOutcome.state;
        log('ERROR', 'EXEC', `FAILED ${sig.pair}: ${execOutcome.errorCode} — ${safeMsg}`);
        await base44.asServiceRole.entities.ArbSignal.update(sig.id, { status: 'rejected', rejection_reason: `${execOutcome.errorCode}:${safeMsg}` }).catch(() => {});
        results.push({ signal_id: sig.id, pair: sig.pair, decision: 'error', error: safeMsg, state: execOutcome.state });
        continue;
      }

      // ── Build trade record ────────────────────────────────────────────────
      const notional    = qty * buyPx;
      const grossSpread = sellPx - buyPx;
      const perLegFee   = notional * (takerBps / 10000);
      const feeTotal    = perLegFee * 4;
      const slipTotal   = notional * (slipBps / 10000);
      const basisPnl    = qty * grossSpread;
      const netPnl      = basisPnl - feeTotal - slipTotal;

      const rootOf   = v => v.replace(/-(spot|perp|swap|futures)$/i, '').trim();
      const buyRoot  = rootOf(String(sig.buy_exchange  || ''));
      const sellRoot = rootOf(String(sig.sell_exchange || ''));
      const buyIsPerp  = /perp|swap|futures/i.test(sig.buy_exchange  || '');
      const sellIsPerp = /perp|swap|futures/i.test(sig.sell_exchange || '');
      const sameVenue  = buyRoot === sellRoot && buyRoot !== '';

      let strategy, spotExchange, perpExchange, spotEntryPx, perpEntryPx, direction;
      if (sameVenue && buyIsPerp !== sellIsPerp) {
        strategy = 'Same-venue Spot/Perp Carry'; spotExchange = buyRoot; perpExchange = buyRoot;
        spotEntryPx = buyIsPerp ? sellPx : buyPx; perpEntryPx = buyIsPerp ? buyPx : sellPx;
        direction = buyIsPerp ? `Long ${buyRoot} perp / Short spot` : `Long ${buyRoot} spot / Short perp`;
      } else if (buyIsPerp && sellIsPerp) {
        strategy = 'Cross-venue Perp/Perp'; perpExchange = `${buyRoot}/${sellRoot}`; spotExchange = null;
        perpEntryPx = buyPx; direction = `Buy ${sig.buy_exchange} / Sell ${sig.sell_exchange}`;
      } else {
        strategy = 'Cross-venue Spot Spread'; spotExchange = `${buyRoot}/${sellRoot}`; perpExchange = null;
        spotEntryPx = buyPx; direction = `Buy ${sig.buy_exchange} / Sell ${sig.sell_exchange}`;
      }

      const d = execOutcome.result;
      const isPartial   = isLive && d && (!d.spotOk || !d.perpOk);
      const tradeStatus = isPartial ? 'Error' : 'Closed';
      const healthScore = computeExecHealthScore(execOutcome);

      const tradeIdSuffix = `${Date.now().toString(36)}-${tradeCounter++}`;
      const trade = await base44.asServiceRole.entities.ArbTrade.create({
        trade_id: `AUTO-${tradeIdSuffix}`, trade_date: todayStr,
        entry_timestamp: new Date().toISOString(), exit_timestamp: new Date().toISOString(),
        status: tradeStatus, strategy, asset: sig.asset || 'Other',
        spot_exchange: spotExchange, perp_exchange: perpExchange, direction,
        spot_entry_px: spotEntryPx || null, perp_entry_px: perpEntryPx || null,
        spot_qty: qty, perp_qty: perpEntryPx ? qty : null,
        gross_spread_entry: grossSpread, entry_spread_bps: rawBps, exit_spread_bps: 0,
        spot_entry_fee: perLegFee, spot_exit_fee: perLegFee,
        perp_entry_fee: perpEntryPx ? perLegFee : null, perp_exit_fee: perpEntryPx ? perLegFee : null,
        expected_slippage: slipTotal, realized_slippage: slipTotal,
        total_realized_fees: feeTotal + slipTotal,
        basis_pnl: basisPnl, net_pnl: netPnl,
        net_pnl_bps: notional > 0 ? (netPnl / notional) * 10000 : 0,
        allocated_capital: notional,
        entry_order_type: 'Market', exit_order_type: 'Market',
        entry_fee_type: 'Taker', exit_fee_type: 'Taker',
        mode: isLive ? 'live' : 'paper',
        review_notes: d ? `state=${execOutcome.state} retries=${execOutcome.retryCount} healthScore=${healthScore} spotOk=${d.spotOk} perpOk=${d.perpOk}` : `state=${execOutcome.state}`,
        entry_thesis: `AUTO signal=${sig.id} net=${net.toFixed(2)}bps conf=${confidence}% ${condition}`,
        net_delta_usd: 0, borrow_conversion_cost: 0,
      });

      await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
        status: 'executed', executed_pnl_bps: trade.net_pnl_bps, executed_pnl_usd: netPnl,
        win: netPnl > 0, notes: `trade=${trade.trade_id} conf=${confidence}% state=${execOutcome.state} score=${healthScore}`,
      });

      log('INFO', 'EXEC', `EXECUTED ${sig.pair} trade=${trade.trade_id} net=${net.toFixed(2)}bps state=${execOutcome.state} score=${healthScore}`);

      if (isPartial) {
        await activateKillSwitch(base44, config.id, sig.pair);
        await sendPartialFillAlert(sig.pair, trade, d, qty);
      }

      results.push({
        signal_id: sig.id, pair: sig.pair, decision: 'executed',
        mode: execOutcome.result?.mode || (isLive ? 'live' : 'paper'),
        trade_id: trade.trade_id, size_usd: Math.round(notional),
        net_bps: Number(net.toFixed(2)), net_pnl_usd: Number(netPnl.toFixed(4)),
        confidence, condition,
        execution_state: execOutcome.state, health_score: healthScore,
        retry_count: execOutcome.retryCount || 0,
        ...(d ? { spot_order_id: d.spotOrderId, perp_order_id: d.perpOrderId } : {}),
      });
    }

    return Response.json({
      ok: true, dry_run: dryRun, paper_trading: config.paper_trading !== false,
      allowed_assets: [...ALLOWED_ASSETS],
      candidates_received: candidates.length,
      to_execute: toExecute.length,
      executed: results.filter(r => r.decision === 'executed').length,
      expired: expiredIds.length,
      hard_stale_cleaned: hardStaleIds.length,
      results,
    });

  } catch (error) {
    log('ERROR', 'FATAL', error.message || 'fatal_error');
    return Response.json({ error: 'execution_service_error' }, { status: 500 });
  }
});