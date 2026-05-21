// order-server.mjs — Production-grade execution server v4
//
// MODULE 1: Production-grade order normalization (BTC/ETH only)
//   - minQty, minNotional, stepSize, tickSize, precision normalization
//   - typed error system, safe rejection handling, logging hooks
// MODULE 2: Resilient execution engine
//   - retry + exponential backoff, circuit breakers
//   - partial fill handling, timeout, ack tracking
// MODULE 3: Latency instrumentation
//   - per-stage timestamps reported back to Base44

import 'dotenv/config';
import { createHmac } from 'crypto';
import http from 'http';
import { writeFile } from 'fs/promises';

// ─── Config ───────────────────────────────────────────────────────────────────

const SECRET       = process.env.DROPLET_SECRET;
const API_KEY      = process.env.BYBIT_API_KEY;
const API_SECRET   = process.env.BYBIT_API_SECRET;
const IS_TESTNET   = (process.env.BYBIT_TESTNET || 'false').toLowerCase() !== 'false';
const BYBIT_BASE   = IS_TESTNET ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
const RESULT_URL   = process.env.BASE44_RESULT_URL;
const TOKEN        = process.env.BASE44_USER_TOKEN;
const PORT         = Number(process.env.ORDER_SERVER_PORT || 4001);

if (!SECRET || !API_KEY || !API_SECRET) {
  console.error('[BOOT] Missing DROPLET_SECRET, BYBIT_API_KEY or BYBIT_API_SECRET');
  process.exit(1);
}

// ── MODULE 1: Typed error codes ───────────────────────────────────────────────

const ERR = {
  ASSET_NOT_ALLOWED:       'ASSET_NOT_ALLOWED',
  MISSING_PRICE:           'MISSING_PRICE',
  MISSING_QTY:             'MISSING_QTY',
  MIN_QTY_VIOLATION:       'MIN_QTY_VIOLATION',
  MIN_NOTIONAL_VIOLATION:  'MIN_NOTIONAL_VIOLATION',
  STEP_SIZE_VIOLATION:     'STEP_SIZE_VIOLATION',
  TICK_SIZE_VIOLATION:     'TICK_SIZE_VIOLATION',
  INSTRUMENT_FETCH_FAILED: 'INSTRUMENT_FETCH_FAILED',
  ORDER_REJECTED:          'ORDER_REJECTED',
  BYBIT_HTTP_ERROR:        'BYBIT_HTTP_ERROR',
  BOTH_LEGS_FAILED:        'BOTH_LEGS_FAILED',
  TIMEOUT:                 'TIMEOUT',
  CIRCUIT_OPEN:            'CIRCUIT_OPEN',
};

class ExecError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code   = code;
    this.detail = detail;
  }
}

// ── Structured logger ─────────────────────────────────────────────────────────

function log(level, module, msg, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, module, msg, ...meta }));
}

// ── MODULE 1: Exchange specs (BTC + ETH only) ─────────────────────────────────
// Specs sourced from Bybit v5 instruments-info + market rules.
// tickSize = price increment; qtyStep = lot size; minQty = min order qty.

const STATIC_SPECS = {
  BTCUSDT: {
    spot:   { tickSize: 0.01, pricePrecision: 2, qtyStep: '0.000001', minQty: 0.000048, minNotionalUsd: 1 },
    linear: { tickSize: 0.10, pricePrecision: 1, qtyStep: '0.001',    minQty: 0.001,    minNotionalUsd: 1 },
  },
  ETHUSDT: {
    spot:   { tickSize: 0.01, pricePrecision: 2, qtyStep: '0.0001',   minQty: 0.000458, minNotionalUsd: 1 },
    linear: { tickSize: 0.01, pricePrecision: 2, qtyStep: '0.01',     minQty: 0.01,     minNotionalUsd: 1 },
  },
};

const ALLOWED_SYMBOLS = new Set(Object.keys(STATIC_SPECS));

// Instrument cache — live values override STATIC_SPECS after first fetch
const instrumentCache = new Map(); // `${category}:${symbol}` → spec + ts
const INSTRUMENT_TTL_MS = 60 * 60 * 1000;

async function getInstrumentSpec(category, symbol) {
  if (!ALLOWED_SYMBOLS.has(symbol)) {
    throw new ExecError(ERR.ASSET_NOT_ALLOWED, `${symbol} not in allowed set [BTCUSDT, ETHUSDT]`);
  }

  const key    = `${category}:${symbol}`;
  const cached = instrumentCache.get(key);
  if (cached && (Date.now() - cached.ts) < INSTRUMENT_TTL_MS) return cached;

  try {
    const url = `${BYBIT_BASE}/v5/market/instruments-info?category=${category}&symbol=${symbol}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    if (!res.ok || json.retCode !== 0) throw new Error(json?.retMsg || res.status);

    const inst = json.result?.list?.[0];
    if (!inst) throw new Error('instrument_not_found');

    const lot = inst.lotSizeFilter || {};
    const price = inst.priceFilter || {};
    const base = STATIC_SPECS[symbol]?.[category] || {};

    const spec = {
      ts:              Date.now(),
      tickSize:        parseFloat(price.tickSize || base.tickSize || '0.01'),
      pricePrecision:  (String(price.tickSize || base.tickSize || '0.01').split('.')[1] || '').length,
      qtyStep:         String(lot.qtyStep || lot.basePrecision || base.qtyStep || '0.001'),
      minQty:          parseFloat(lot.minOrderQty || base.minQty || '0'),
      minNotionalUsd:  parseFloat(lot.minOrderAmt || base.minNotionalUsd || '1'),
    };

    instrumentCache.set(key, spec);
    log('INFO', 'SPEC', `Loaded live spec ${key}`, { tickSize: spec.tickSize, qtyStep: spec.qtyStep, minQty: spec.minQty });
    return spec;

  } catch (e) {
    const fallback = STATIC_SPECS[symbol]?.[category];
    if (fallback) {
      log('WARN', 'SPEC', `Using static fallback for ${key}`, { error: e.message });
      const spec = { ts: Date.now(), ...fallback };
      instrumentCache.set(key, spec);
      return spec;
    }
    throw new ExecError(ERR.INSTRUMENT_FETCH_FAILED, `${key}: ${e.message}`);
  }
}

// ── MODULE 1: Price normalization ─────────────────────────────────────────────

function normalizePrice(price, tickSize, precision) {
  const rounded = Math.round(price / tickSize) * tickSize;
  const result  = parseFloat(rounded.toFixed(precision));
  if (Math.abs(rounded - price) / price > 0.001) {
    log('WARN', 'NORM', `Price ${price} rounded to ${result} (tickSize=${tickSize})`);
  }
  return result;
}

// ── MODULE 1: Quantity normalization ──────────────────────────────────────────

function normalizeQty(qty, spec) {
  const step     = parseFloat(spec.qtyStep);
  const decimals = (spec.qtyStep.split('.')[1] || '').length;
  const floored  = Math.floor(qty / step + 1e-12) * step;
  return parseFloat(floored.toFixed(decimals));
}

// ── MODULE 1: Full order normalization + validation ───────────────────────────
// Returns { ok, order } or throws ExecError

async function normalizeAndValidateOrder(category, symbol, rawQty, rawPrice) {
  const spec = await getInstrumentSpec(category, symbol);

  if (!rawPrice || rawPrice <= 0) throw new ExecError(ERR.MISSING_PRICE, `price=${rawPrice}`);
  if (!rawQty  || rawQty  <= 0) throw new ExecError(ERR.MISSING_QTY,   `qty=${rawQty}`);

  const normPrice = normalizePrice(rawPrice, spec.tickSize, spec.pricePrecision);
  const normQty   = normalizeQty(rawQty, spec);

  // minQty check
  if (normQty < spec.minQty) {
    throw new ExecError(ERR.MIN_QTY_VIOLATION,
      `qty ${normQty} < minQty ${spec.minQty} for ${symbol}/${category}`);
  }

  const notional = normQty * normPrice;

  // minNotional check
  if (notional < spec.minNotionalUsd) {
    throw new ExecError(ERR.MIN_NOTIONAL_VIOLATION,
      `notional $${notional.toFixed(4)} < minNotional $${spec.minNotionalUsd} for ${symbol}`);
  }

  log('INFO', 'NORM', `Normalized ${symbol}/${category}`, {
    rawQty, normQty, rawPrice, normPrice, notional: notional.toFixed(4)
  });

  return { spec, normQty, normQtyStr: String(normQty.toFixed((spec.qtyStep.split('.')[1] || '').length)), normPrice, notional };
}

// ─── Bybit signing ────────────────────────────────────────────────────────────

function bybitSign(preSign) {
  return createHmac('sha256', API_SECRET).update(preSign).digest('hex');
}

// ── MODULE 2: Single order with timeout ───────────────────────────────────────

async function bybitOrder({ category, symbol, side, qty, timeoutMs = 5000 }) {
  const timestamp   = Date.now().toString();
  const recvWindow  = '5000';
  const orderBody   = { category, symbol, side, orderType: 'Market', qty: String(qty), timeInForce: 'IOC' };
  const bodyStr     = JSON.stringify(orderBody);
  const preSign     = timestamp + API_KEY + recvWindow + bodyStr;
  const signature   = bybitSign(preSign);

  const sentAt = Date.now();
  const res = await fetch(`${BYBIT_BASE}/v5/order/create`, {
    method: 'POST',
    headers: {
      'X-BAPI-API-KEY':      API_KEY,
      'X-BAPI-SIGN':         signature,
      'X-BAPI-TIMESTAMP':    timestamp,
      'X-BAPI-RECV-WINDOW':  recvWindow,
      'Content-Type':        'application/json',
    },
    body: bodyStr,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const ackAt = Date.now();
  const json  = await res.json().catch(() => null);

  if (!res.ok || !json) throw new ExecError(ERR.BYBIT_HTTP_ERROR, `HTTP ${res.status}`);
  if (json.retCode !== 0) throw new ExecError(ERR.ORDER_REJECTED, `${json.retMsg} (${json.retCode})`);

  log('INFO', 'ORDER', `ACK ${side} ${symbol}/${category}`, {
    orderId: json.result?.orderId, ackLatencyMs: ackAt - sentAt
  });

  return { orderId: json.result?.orderId, retCode: json.retCode, sentAt, ackAt };
}

// ── MODULE 2: Circuit breaker (in-process, per symbol) ────────────────────────

const circuitBreakers = new Map();

function getCircuit(symbol) {
  if (!circuitBreakers.has(symbol)) {
    circuitBreakers.set(symbol, { state: 'CLOSED', failures: 0, openedAt: null, nextRetryAt: null });
  }
  return circuitBreakers.get(symbol);
}

function isCircuitOpen(symbol) {
  const cb = getCircuit(symbol);
  if (cb.state === 'CLOSED')    return false;
  if (cb.state === 'OPEN') {
    if (Date.now() >= cb.nextRetryAt) { cb.state = 'HALF_OPEN'; return false; }
    return true;
  }
  return false;
}

function recordCircuitSuccess(symbol) {
  const cb = getCircuit(symbol);
  cb.failures = 0;
  if (cb.state === 'HALF_OPEN') { cb.state = 'CLOSED'; log('INFO', 'CB', `Circuit CLOSED for ${symbol}`); }
}

function recordCircuitFailure(symbol, err) {
  const cb = getCircuit(symbol);
  cb.failures += 1;
  if (cb.failures >= 3 || cb.state === 'HALF_OPEN') {
    cb.state       = 'OPEN';
    cb.openedAt    = Date.now();
    cb.nextRetryAt = Date.now() + 15 * 60 * 1000; // 900s cooldown (ARB_CONFIG)
    log('ERROR', 'CB', `Circuit OPENED for ${symbol} after ${cb.failures} failures`, { error: err });
  }
}

// ── MODULE 2: Retry with exponential backoff ──────────────────────────────────

async function withRetry(fn, symbol, maxAttempts = 2) {
  const delays = [0, 500];
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) { log('INFO', 'RETRY', `Backoff ${delays[i]}ms attempt ${i+1}/${maxAttempts}`, { symbol }); await new Promise(r => setTimeout(r, delays[i])); }
    try {
      const result = await fn();
      recordCircuitSuccess(symbol);
      return result;
    } catch (e) {
      lastErr = e;
      log('WARN', 'RETRY', `Attempt ${i+1} failed`, { symbol, error: e.message || e });
    }
  }
  recordCircuitFailure(symbol, lastErr?.message);
  throw lastErr;
}

// ─── MODULE 2 + 3: Execute both legs with latency tracking ───────────────────

async function executeBothLegs(signal) {
  const t0     = Date.now();
  const asset  = String(signal.asset || signal.pair?.split('-')[0] || 'BTC').toUpperCase();
  const symbol = asset + 'USDT';

  if (!ALLOWED_SYMBOLS.has(symbol)) {
    throw new ExecError(ERR.ASSET_NOT_ALLOWED, `${symbol} not in [BTCUSDT, ETHUSDT]`);
  }

  if (isCircuitOpen(symbol)) {
    throw new ExecError(ERR.CIRCUIT_OPEN, `Circuit is OPEN for ${symbol}`);
  }

  const rawQty    = Number(signal.qty);
  const buyIsPerp  = /perp|swap|linear/i.test(signal.buy_exchange  || '');
  const sellIsPerp = /perp|swap|linear/i.test(signal.sell_exchange || '');

  const latency = { t0, validationStart: t0 };

  // ── CROSS-VENUE SPOT/SPOT: Only execute the Bybit leg ────────────────────
  if (!buyIsPerp && !sellIsPerp) {
    const isBuyBybit  = signal.buy_exchange?.toLowerCase().includes('bybit');
    const isSellBybit = signal.sell_exchange?.toLowerCase().includes('bybit');
    if (!isBuyBybit && !isSellBybit) throw new ExecError('NO_BYBIT_LEG', 'cross_venue_spot no Bybit leg');

    const side         = isBuyBybit ? 'Buy' : 'Sell';
    const refPrice     = Number(isBuyBybit ? signal.buy_price : signal.sell_price) || 0;
    const { normQtyStr, normQty } = await normalizeAndValidateOrder('spot', symbol, rawQty, refPrice);

    latency.validationEnd = Date.now();
    latency.orderSentAt   = Date.now();

    const spotRes = await withRetry(
      () => bybitOrder({ category: 'spot', symbol, side, qty: normQtyStr }),
      symbol
    );

    latency.ackAt  = spotRes.ackAt;
    latency.fillAt = Date.now();

    log('INFO', 'EXEC', `cross_venue_spot ${symbol} ${side} qty=${normQtyStr}`, {
      orderId: spotRes.orderId, totalMs: latency.fillAt - latency.t0
    });

    return {
      spotOk: true, perpOk: true, spotOrderId: spotRes.orderId, perpOrderId: null,
      symbol, spotSide: side, perpSide: null, mode: 'live_cross_venue_spot',
      latency,
    };
  }

  // ── SPOT/PERP or PERP/PERP ───────────────────────────────────────────────
  let spotSide, perpSide;
  if      (!buyIsPerp && sellIsPerp)  { spotSide = 'Buy';  perpSide = 'Sell'; }
  else if (buyIsPerp  && !sellIsPerp) { spotSide = 'Sell'; perpSide = 'Buy';  }
  else                                { spotSide = 'Buy';  perpSide = 'Sell'; }

  const refPrice = Number(signal.buy_price) || 0;

  const [spotNorm, perpNorm] = await Promise.all([
    normalizeAndValidateOrder('spot',   symbol, rawQty, refPrice),
    normalizeAndValidateOrder('linear', symbol, rawQty, refPrice),
  ]);

  latency.validationEnd = Date.now();

  log('INFO', 'EXEC', `dual_leg ${symbol}`, {
    spotQty: spotNorm.normQtyStr, perpQty: perpNorm.normQtyStr,
    spotSide, perpSide, validationMs: latency.validationEnd - latency.validationStart
  });

  latency.orderSentAt = Date.now();

  const [spotRes, perpRes] = await Promise.allSettled([
    withRetry(() => bybitOrder({ category: 'spot',   symbol, side: spotSide, qty: spotNorm.normQtyStr }), symbol),
    withRetry(() => bybitOrder({ category: 'linear', symbol, side: perpSide, qty: perpNorm.normQtyStr }), symbol),
  ]);

  latency.ackAt  = Date.now(); // both settled
  latency.fillAt = Date.now();

  const spotOk = spotRes.status === 'fulfilled';
  const perpOk = perpRes.status === 'fulfilled';

  if (!spotOk && !perpOk) {
    throw new ExecError(ERR.BOTH_LEGS_FAILED,
      `spot=${spotRes.reason?.message} perp=${perpRes.reason?.message}`);
  }

  if (!spotOk || !perpOk) {
    const spotErr = !spotOk ? spotRes.reason?.message : 'ok';
    const perpErr = !perpOk ? perpRes.reason?.message : 'ok';
    log('ERROR', 'EXEC', `PARTIAL FILL ${symbol} — MANUAL REVIEW REQUIRED`, { spotErr, perpErr });
  }

  const totalMs = latency.fillAt - latency.t0;
  log('INFO', 'EXEC', `dual_leg complete ${symbol}`, { spotOk, perpOk, totalMs });

  return {
    spotOk, perpOk,
    spotOrderId: spotRes.value?.orderId,
    perpOrderId: perpRes.value?.orderId,
    symbol, spotSide, perpSide,
    mode: spotOk && perpOk ? 'live' : 'live_partial',
    latency,
  };
}

// ─── Report result + latency back to Base44 ───────────────────────────────────

async function reportResult(payload) {
  if (!RESULT_URL || !TOKEN) return;
  fetch(RESULT_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
    body:    JSON.stringify(payload),
  }).catch(e => log('ERROR', 'REPORT', 'Failed to report result', { error: e.message }));
}

// ─── Fetch wallet balance ─────────────────────────────────────────────────────

async function fetchBalance() {
  const timestamp  = Date.now().toString();
  const recvWindow = '5000';
  const queryStr   = 'accountType=UNIFIED';
  // Bybit v5 GET signing: timestamp + apiKey + recvWindow + queryString
  const preSign    = timestamp + API_KEY + recvWindow + queryStr;
  const signature  = bybitSign(preSign);

  const res = await fetch(`${BYBIT_BASE}/v5/account/wallet-balance?${queryStr}`, {
    headers: {
      'X-BAPI-API-KEY': API_KEY, 'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp, 'X-BAPI-RECV-WINDOW': recvWindow,
    },
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(`Bybit HTTP ${res.status}`);
  if (json.retCode !== 0) throw new Error(`Bybit error: ${json.retMsg}`);
  const account = json.result?.list?.[0] || {};
  return {
    totalEquity: parseFloat(account.totalEquity || 0),
    totalAvailableBalance: parseFloat(account.totalAvailableBalance || 0),
    coins: account.coin || [],
  };
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { reject(new Error('invalid_json')); }
    });
  });
}

function authCheck(req, res) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim()
             || req.headers['x-droplet-secret'];
  if (token !== SECRET) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const method = req.method;
  const url    = req.url || '';

  // ── Health ────────────────────────────────────────────────────────────────
  if (method === 'GET' && url === '/health') {
    const circuits = Object.fromEntries([...circuitBreakers.entries()].map(([k, v]) => [k, v.state]));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, env: IS_TESTNET ? 'testnet' : 'mainnet', allowed_symbols: [...ALLOWED_SYMBOLS], circuits, ts: new Date().toISOString() }));
    return;
  }

  // ── Balance ───────────────────────────────────────────────────────────────
  if (method === 'GET' && (url === '/balance' || url === '/api/balance')) {
    if (!authCheck(req, res)) return;
    try {
      const b = await fetchBalance();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...b, testnet: IS_TESTNET }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Price proxy ───────────────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/price')) {
    if (!authCheck(req, res)) return;
    const params   = new URL(url, 'http://x').searchParams;
    const symbol   = (params.get('symbol') || '').toUpperCase();
    const category = (params.get('category') || 'spot').toLowerCase();
    if (!symbol) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing_symbol' })); return; }
    try {
      const r = await fetch(`${BYBIT_BASE}/v5/market/tickers?category=${category}&symbol=${symbol}`, { signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      const price = parseFloat(j.result?.list?.[0]?.lastPrice || 0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, symbol, category, price }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  // ── Restart ───────────────────────────────────────────────────────────────
  if (method === 'POST' && url === '/restart') {
    if (!authCheck(req, res)) return;
    res.writeHead(200); res.end(JSON.stringify({ status: 'restart_initiated', ts: new Date().toISOString() }));
    setTimeout(() => process.exit(0), 500);
    return;
  }

  // ── Single order (test) ───────────────────────────────────────────────────
  if (method === 'POST' && url === '/single-order') {
    if (!authCheck(req, res)) return;
    let order;
    try { order = await parseBody(req); } catch { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid_json' })); return; }

    const symbol   = String(order.symbol   || '').toUpperCase();
    const side     = String(order.side     || 'Buy');
    const category = String(order.category || 'spot');
    const rawQty   = parseFloat(order.qty);

    try {
      const { normQtyStr } = await normalizeAndValidateOrder(category, symbol, rawQty, parseFloat(order.price || 0) || 999999);
      const result = await bybitOrder({ category, symbol, side, qty: normQtyStr });
      res.writeHead(200); res.end(JSON.stringify({ ok: true, orderId: result.orderId, symbol, side, category, qty: normQtyStr }));
    } catch (e) {
      log('ERROR', 'SINGLE', `FAILED ${symbol}/${category}/${side}`, { error: e.message });
      res.writeHead(e.code === ERR.ASSET_NOT_ALLOWED ? 400 : 500);
      res.end(JSON.stringify({ ok: false, error: e.message, code: e.code }));
    }
    return;
  }

  // ── Execute (main) ────────────────────────────────────────────────────────
  if (method === 'POST' && url === '/execute') {
    if (!authCheck(req, res)) return;

    let signal;
    try { signal = await parseBody(req); } catch { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid_json' })); return; }

    if (!signal.pair || !signal.qty || !signal.buy_exchange || !signal.sell_exchange) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'missing: pair, qty, buy_exchange, sell_exchange' })); return;
    }

    const asset = String(signal.asset || signal.pair?.split('-')[0] || '').toUpperCase();
    if (!ALLOWED_SYMBOLS.has(asset + 'USDT')) {
      res.writeHead(400); res.end(JSON.stringify({ ok: false, error: `${ERR.ASSET_NOT_ALLOWED}: only BTC/ETH allowed`, code: ERR.ASSET_NOT_ALLOWED }));
      return;
    }

    const execStart = Date.now();
    let result;
    try {
      result = await executeBothLegs(signal);
      log('INFO', 'EXEC', `OK signal=${signal.signal_id} mode=${result.mode}`, { totalMs: Date.now() - execStart });
    } catch (e) {
      const safeErr = e.message?.slice(0, 200) || 'unknown';
      const errCode = e.code || 'EXEC_FAILED';
      log('ERROR', 'EXEC', `FAILED signal=${signal.signal_id}`, { error: safeErr, code: errCode, totalMs: Date.now() - execStart });
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: safeErr, code: errCode }));
      reportResult({ signal_id: signal.signal_id, trade_id: signal.trade_id, ok: false, error: safeErr, code: errCode });
      return;
    }

    res.writeHead(200); res.end(JSON.stringify({ ok: true, ...result }));

    // Report back with full latency breakdown (fire and forget)
    reportResult({
      signal_id:   signal.signal_id,
      trade_id:    signal.trade_id,
      ok:          true,
      mode:        result.mode,
      spotOk:      result.spotOk,
      perpOk:      result.perpOk,
      spotOrderId: result.spotOrderId,
      perpOrderId: result.perpOrderId,
      symbol:      result.symbol,
      qty:         signal.qty,
      buy_price:   signal.buy_price,
      sell_price:  signal.sell_price,
      net_edge_bps: signal.net_edge_bps,
      // MODULE 3: latency timestamps
      latency: result.latency,
    });
    return;
  }

  // ── Setup ─────────────────────────────────────────────────────────────────
  if (method === 'POST' && url === '/setup') {
    if (!authCheck(req, res)) return;
    let payload;
    try { payload = await parseBody(req); } catch { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid_json' })); return; }
    const { orderServerCode, envVars } = payload;
    if (!orderServerCode || !envVars) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing_fields' })); return; }
    const envContent = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join('\n');
    await writeFile('/opt/arb-bot/.env', envContent, 'utf8');
    await writeFile('/opt/arb-bot/bot.mjs', orderServerCode, 'utf8');
    res.writeHead(200); res.end(JSON.stringify({ status: 'setup_complete', ts: new Date().toISOString() }));
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  log('INFO', 'BOOT', `order-server v4 listening :${PORT}`, {
    env: IS_TESTNET ? 'testnet' : 'mainnet',
    allowed_symbols: [...ALLOWED_SYMBOLS],
  });
});