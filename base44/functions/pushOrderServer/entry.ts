// pushOrderServer — Pushes order-server.mjs v4 to the droplet via /setup + /restart.
// v4: BTC/ETH only, typed errors, circuit breakers, retry/backoff, latency tracking.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ORDER_SERVER_CODE = `// order-server.mjs — Production-grade execution server v4
// ---- EMBED: droplet-bot/order-server.mjs v4 ----
// BTC/ETH only | typed errors | circuit breakers | retry/backoff | latency tracking
import 'dotenv/config';
import { createHmac } from 'crypto';
import http from 'http';
import { writeFile } from 'fs/promises';

const SECRET       = process.env.DROPLET_SECRET;
const API_KEY      = process.env.BYBIT_API_KEY;
const API_SECRET   = process.env.BYBIT_API_SECRET;
const IS_TESTNET   = (process.env.BYBIT_TESTNET || 'false').toLowerCase() !== 'false';
const BYBIT_BASE   = IS_TESTNET ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
const RESULT_URL   = process.env.BASE44_RESULT_URL;
const TOKEN        = process.env.BASE44_USER_TOKEN;
const PORT         = Number(process.env.ORDER_SERVER_PORT || 4001);
if (!SECRET || !API_KEY || !API_SECRET) { console.error('[BOOT] Missing DROPLET_SECRET, BYBIT_API_KEY or BYBIT_API_SECRET'); process.exit(1); }
const ERR = { ASSET_NOT_ALLOWED:'ASSET_NOT_ALLOWED', MISSING_PRICE:'MISSING_PRICE', MISSING_QTY:'MISSING_QTY', MIN_QTY_VIOLATION:'MIN_QTY_VIOLATION', MIN_NOTIONAL_VIOLATION:'MIN_NOTIONAL_VIOLATION', INSTRUMENT_FETCH_FAILED:'INSTRUMENT_FETCH_FAILED', ORDER_REJECTED:'ORDER_REJECTED', BYBIT_HTTP_ERROR:'BYBIT_HTTP_ERROR', BOTH_LEGS_FAILED:'BOTH_LEGS_FAILED', CIRCUIT_OPEN:'CIRCUIT_OPEN' };
class ExecError extends Error { constructor(code, detail) { super(code + ': ' + detail); this.code = code; this.detail = detail; } }
function log(level, mod, msg, meta) { console.log(JSON.stringify(Object.assign({ ts: new Date().toISOString(), level, mod, msg }, meta || {}))); }
const STATIC_SPECS = { BTCUSDT: { spot: { tickSize:0.01, pricePrecision:2, qtyStep:'0.000001', minQty:0.000048, minNotionalUsd:1 }, linear: { tickSize:0.10, pricePrecision:1, qtyStep:'0.001', minQty:0.001, minNotionalUsd:1 } }, ETHUSDT: { spot: { tickSize:0.01, pricePrecision:2, qtyStep:'0.0001', minQty:0.000458, minNotionalUsd:1 }, linear: { tickSize:0.01, pricePrecision:2, qtyStep:'0.01', minQty:0.01, minNotionalUsd:1 } } };
const ALLOWED_SYMBOLS = new Set(Object.keys(STATIC_SPECS));
const instrumentCache = new Map();
const INSTRUMENT_TTL_MS = 3600000;
async function getInstrumentSpec(category, symbol) {
  if (!ALLOWED_SYMBOLS.has(symbol)) throw new ExecError(ERR.ASSET_NOT_ALLOWED, symbol + ' not in [BTCUSDT,ETHUSDT]');
  const key = category + ':' + symbol; const cached = instrumentCache.get(key);
  if (cached && (Date.now() - cached.ts) < INSTRUMENT_TTL_MS) return cached;
  try {
    const res = await fetch(BYBIT_BASE + '/v5/market/instruments-info?category=' + category + '&symbol=' + symbol, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    if (!res.ok || json.retCode !== 0) throw new Error(json && json.retMsg || res.status);
    const inst = json.result && json.result.list && json.result.list[0];
    if (!inst) throw new Error('not_found');
    const lot = inst.lotSizeFilter || {}; const price = inst.priceFilter || {}; const base = (STATIC_SPECS[symbol] || {})[category] || {};
    const spec = { ts: Date.now(), tickSize: parseFloat(price.tickSize || base.tickSize || '0.01'), pricePrecision: (String(price.tickSize || base.tickSize || '0.01').split('.')[1] || '').length, qtyStep: String(lot.qtyStep || lot.basePrecision || base.qtyStep || '0.001'), minQty: parseFloat(lot.minOrderQty || base.minQty || '0'), minNotionalUsd: parseFloat(lot.minOrderAmt || base.minNotionalUsd || '1') };
    instrumentCache.set(key, spec); log('INFO','SPEC','Loaded '+key, { tickSize: spec.tickSize, qtyStep: spec.qtyStep }); return spec;
  } catch(e) { const fb = (STATIC_SPECS[symbol] || {})[category]; if (fb) { const spec = Object.assign({ ts: Date.now() }, fb); instrumentCache.set(key, spec); return spec; } throw new ExecError(ERR.INSTRUMENT_FETCH_FAILED, key + ': ' + e.message); }
}
function normalizePrice(price, tickSize, precision) { return parseFloat((Math.round(price / tickSize) * tickSize).toFixed(precision)); }
function normalizeQty(qty, spec) { const step = parseFloat(spec.qtyStep); const dec = (spec.qtyStep.split('.')[1] || '').length; return parseFloat((Math.floor(qty / step + 1e-12) * step).toFixed(dec)); }
async function normalizeAndValidateOrder(category, symbol, rawQty, rawPrice) {
  const spec = await getInstrumentSpec(category, symbol);
  if (!rawPrice || rawPrice <= 0) throw new ExecError(ERR.MISSING_PRICE, 'price=' + rawPrice);
  if (!rawQty  || rawQty  <= 0) throw new ExecError(ERR.MISSING_QTY, 'qty=' + rawQty);
  const normPrice = normalizePrice(rawPrice, spec.tickSize, spec.pricePrecision);
  const normQty   = normalizeQty(rawQty, spec);
  if (normQty < spec.minQty) throw new ExecError(ERR.MIN_QTY_VIOLATION, 'qty ' + normQty + ' < minQty ' + spec.minQty + ' for ' + symbol + '/' + category);
  const notional = normQty * normPrice;
  if (notional < spec.minNotionalUsd) throw new ExecError(ERR.MIN_NOTIONAL_VIOLATION, 'notional $' + notional.toFixed(4) + ' < $' + spec.minNotionalUsd);
  const qtyDec = (spec.qtyStep.split('.')[1] || '').length;
  log('INFO','NORM','Normalized ' + symbol + '/' + category, { rawQty, normQty, rawPrice, normPrice, notional: notional.toFixed(4) });
  return { spec, normQty, normQtyStr: normQty.toFixed(qtyDec), normPrice, notional };
}
function bybitSign(preSign) { return require('crypto').createHmac('sha256', API_SECRET).update(preSign).digest('hex'); }
async function bybitOrder(params) {
  const { category, symbol, side, qty, timeoutMs } = params;
  const ts = Date.now().toString(); const rw = '5000';
  const ob = { category, symbol, side, orderType: 'Market', qty: String(qty), timeInForce: 'IOC' };
  const bs = JSON.stringify(ob); const sig = bybitSign(ts + API_KEY + rw + bs);
  const sentAt = Date.now();
  const res = await fetch(BYBIT_BASE + '/v5/order/create', { method:'POST', headers:{ 'X-BAPI-API-KEY':API_KEY, 'X-BAPI-SIGN':sig, 'X-BAPI-TIMESTAMP':ts, 'X-BAPI-RECV-WINDOW':rw, 'Content-Type':'application/json' }, body:bs, signal: AbortSignal.timeout(timeoutMs || 8000) });
  const ackAt = Date.now(); const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new ExecError(ERR.BYBIT_HTTP_ERROR, 'HTTP ' + res.status);
  if (json.retCode !== 0) throw new ExecError(ERR.ORDER_REJECTED, json.retMsg + ' (' + json.retCode + ')');
  log('INFO','ORDER','ACK ' + side + ' ' + symbol + '/' + category, { orderId: json.result && json.result.orderId, ackLatencyMs: ackAt - sentAt });
  return { orderId: json.result && json.result.orderId, sentAt, ackAt };
}
const circuitBreakers = new Map();
function getCircuit(sym) { if (!circuitBreakers.has(sym)) circuitBreakers.set(sym, { state:'CLOSED', failures:0, openedAt:null, nextRetryAt:null }); return circuitBreakers.get(sym); }
function isCircuitOpen(sym) { const cb = getCircuit(sym); if (cb.state === 'CLOSED') return false; if (cb.state === 'OPEN') { if (Date.now() >= cb.nextRetryAt) { cb.state = 'HALF_OPEN'; return false; } return true; } return false; }
function recordCircuitSuccess(sym) { const cb = getCircuit(sym); cb.failures = 0; if (cb.state === 'HALF_OPEN') { cb.state = 'CLOSED'; log('INFO','CB','Circuit CLOSED for ' + sym); } }
function recordCircuitFailure(sym, err) { const cb = getCircuit(sym); cb.failures += 1; if (cb.failures >= 3 || cb.state === 'HALF_OPEN') { cb.state = 'OPEN'; cb.openedAt = Date.now(); cb.nextRetryAt = Date.now() + 300000; log('ERROR','CB','Circuit OPENED for ' + sym, { error: err }); } }
async function withRetry(fn, sym) {
  const delays = [0, 300, 900]; let lastErr;
  for (let i = 0; i < 3; i++) {
    if (i > 0) { await new Promise(r => setTimeout(r, delays[i])); }
    try { const r = await fn(); recordCircuitSuccess(sym); return r; } catch(e) { lastErr = e; log('WARN','RETRY','Attempt ' + (i+1) + ' failed', { sym, error: e.message }); }
  }
  recordCircuitFailure(sym, lastErr && lastErr.message); throw lastErr;
}
async function executeBothLegs(signal) {
  const t0 = Date.now();
  const asset = String(signal.asset || (signal.pair && signal.pair.split('-')[0]) || 'BTC').toUpperCase();
  const symbol = asset + 'USDT';
  if (!ALLOWED_SYMBOLS.has(symbol)) throw new ExecError(ERR.ASSET_NOT_ALLOWED, symbol + ' not in [BTCUSDT,ETHUSDT]');
  if (isCircuitOpen(symbol)) throw new ExecError(ERR.CIRCUIT_OPEN, 'Circuit OPEN for ' + symbol);
  const rawQty = Number(signal.qty);
  const buyIsPerp = /perp|swap|linear/i.test(signal.buy_exchange || '');
  const sellIsPerp = /perp|swap|linear/i.test(signal.sell_exchange || '');
  const latency = { t0, validationStart: t0 };
  if (!buyIsPerp && !sellIsPerp) {
    const isBuyBybit = (signal.buy_exchange || '').toLowerCase().includes('bybit');
    const isSellBybit = (signal.sell_exchange || '').toLowerCase().includes('bybit');
    if (!isBuyBybit && !isSellBybit) throw new ExecError('NO_BYBIT_LEG','cross_venue_spot no Bybit leg');
    const side = isBuyBybit ? 'Buy' : 'Sell';
    const refPrice = Number(isBuyBybit ? signal.buy_price : signal.sell_price) || 0;
    const norm = await normalizeAndValidateOrder('spot', symbol, rawQty, refPrice);
    latency.validationEnd = Date.now(); latency.orderSentAt = Date.now();
    const spotRes = await withRetry(() => bybitOrder({ category:'spot', symbol, side, qty: norm.normQtyStr }), symbol);
    latency.ackAt = spotRes.ackAt; latency.fillAt = Date.now();
    return { spotOk:true, perpOk:true, spotOrderId: spotRes.orderId, perpOrderId:null, symbol, mode:'live_cross_venue_spot', latency };
  }
  let spotSide, perpSide;
  if (!buyIsPerp && sellIsPerp) { spotSide = 'Buy'; perpSide = 'Sell'; }
  else if (buyIsPerp && !sellIsPerp) { spotSide = 'Sell'; perpSide = 'Buy'; }
  else { spotSide = 'Buy'; perpSide = 'Sell'; }
  const refPrice = Number(signal.buy_price) || 0;
  const [spotNorm, perpNorm] = await Promise.all([normalizeAndValidateOrder('spot', symbol, rawQty, refPrice), normalizeAndValidateOrder('linear', symbol, rawQty, refPrice)]);
  latency.validationEnd = Date.now();
  log('INFO','EXEC','dual_leg ' + symbol, { spotQty: spotNorm.normQtyStr, perpQty: perpNorm.normQtyStr, spotSide, perpSide });
  latency.orderSentAt = Date.now();
  const [spotRes, perpRes] = await Promise.allSettled([withRetry(() => bybitOrder({ category:'spot', symbol, side:spotSide, qty:spotNorm.normQtyStr }), symbol), withRetry(() => bybitOrder({ category:'linear', symbol, side:perpSide, qty:perpNorm.normQtyStr }), symbol)]);
  latency.ackAt = Date.now(); latency.fillAt = Date.now();
  const spotOk = spotRes.status === 'fulfilled'; const perpOk = perpRes.status === 'fulfilled';
  if (!spotOk && !perpOk) throw new ExecError(ERR.BOTH_LEGS_FAILED, 'spot=' + (spotRes.reason && spotRes.reason.message) + ' perp=' + (perpRes.reason && perpRes.reason.message));
  if (!spotOk || !perpOk) log('ERROR','EXEC','PARTIAL FILL ' + symbol + ' — MANUAL REVIEW', { spotOk, perpOk });
  log('INFO','EXEC','dual_leg complete ' + symbol, { spotOk, perpOk, totalMs: latency.fillAt - t0 });
  return { spotOk, perpOk, spotOrderId: spotRes.value && spotRes.value.orderId, perpOrderId: perpRes.value && perpRes.value.orderId, symbol, spotSide, perpSide, mode: spotOk && perpOk ? 'live' : 'live_partial', latency };
}
function reportResult(payload) {
  if (!RESULT_URL || !TOKEN) return;
  fetch(RESULT_URL, { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + TOKEN }, body: JSON.stringify(payload) }).catch(e => log('ERROR','REPORT','failed', { error: e.message }));
}
async function fetchBalance() {
  const ts = Date.now().toString(); const rw = '5000'; const sig = bybitSign(ts + API_KEY + rw);
  const res = await fetch(BYBIT_BASE + '/v5/account/wallet-balance?accountType=UNIFIED', { headers: { 'X-BAPI-API-KEY':API_KEY, 'X-BAPI-SIGN':sig, 'X-BAPI-TIMESTAMP':ts, 'X-BAPI-RECV-WINDOW':rw }, signal: AbortSignal.timeout(8000) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error('Bybit HTTP ' + res.status);
  if (json.retCode !== 0) throw new Error('Bybit error: ' + json.retMsg);
  const acct = (json.result && json.result.list && json.result.list[0]) || {};
  return { totalEquity: parseFloat(acct.totalEquity || 0), totalAvailableBalance: parseFloat(acct.totalAvailableBalance || 0), coins: acct.coin || [] };
}
function parseBody(req) { return new Promise((resolve, reject) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error('invalid_json')); } }); }); }
function authCheck(req, res) { const t = ((req.headers['authorization'] || '').replace('Bearer ','').trim()) || req.headers['x-droplet-secret']; if (t !== SECRET) { res.writeHead(401, {'Content-Type':'application/json'}); res.end('{"error":"unauthorized"}'); return false; } return true; }
const server = http.createServer(async (req, res) => {
  const method = req.method; const url = req.url || '';
  if (method === 'GET' && url === '/health') { const circuits = Object.fromEntries([...circuitBreakers.entries()].map(([k,v]) => [k,v.state])); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ ok:true, version:'v4', env: IS_TESTNET?'testnet':'mainnet', allowed_symbols:[...ALLOWED_SYMBOLS], circuits, ts: new Date().toISOString() })); return; }
  if (method === 'GET' && (url === '/balance' || url === '/api/balance')) { if (!authCheck(req,res)) return; try { const b = await fetchBalance(); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(Object.assign({}, b, { testnet: IS_TESTNET }))); } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); } return; }
  if (method === 'GET' && url.startsWith('/price')) { if (!authCheck(req,res)) return; const p = new URL(url,'http://x').searchParams; const sym = (p.get('symbol')||'').toUpperCase(); const cat = (p.get('category')||'spot').toLowerCase(); if (!sym) { res.writeHead(400); res.end('{"error":"missing_symbol"}'); return; } try { const r = await fetch(BYBIT_BASE+'/v5/market/tickers?category='+cat+'&symbol='+sym, { signal: AbortSignal.timeout(5000) }); const j = await r.json(); const price = parseFloat((j.result&&j.result.list&&j.result.list[0]&&j.result.list[0].lastPrice)||0); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ ok:true, symbol:sym, category:cat, price })); } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); } return; }
  if (method === 'POST' && url === '/restart') { if (!authCheck(req,res)) return; res.writeHead(200); res.end(JSON.stringify({ status:'restart_initiated', ts: new Date().toISOString() })); setTimeout(() => process.exit(0), 500); return; }
  if (method === 'POST' && url === '/single-order') {
    if (!authCheck(req,res)) return;
    let order; try { order = await parseBody(req); } catch { res.writeHead(400); res.end('{"error":"invalid_json"}'); return; }
    const sym = String(order.symbol||'').toUpperCase(); const side = String(order.side||'Buy'); const cat = String(order.category||'spot'); const rq = parseFloat(order.qty);
    try { const n = await normalizeAndValidateOrder(cat, sym, rq, parseFloat(order.price||0)||999999); const result = await bybitOrder({ category:cat, symbol:sym, side, qty:n.normQtyStr }); res.writeHead(200); res.end(JSON.stringify({ ok:true, orderId:result.orderId, symbol:sym, side, category:cat, qty:n.normQtyStr })); }
    catch(e) { log('ERROR','SINGLE','FAILED '+sym+'/'+cat+'/'+side,{ error:e.message }); res.writeHead(e.code===ERR.ASSET_NOT_ALLOWED?400:500); res.end(JSON.stringify({ ok:false, error:e.message, code:e.code })); }
    return;
  }
  if (method === 'POST' && url === '/execute') {
    if (!authCheck(req,res)) return;
    let signal; try { signal = await parseBody(req); } catch { res.writeHead(400); res.end('{"error":"invalid_json"}'); return; }
    if (!signal.pair || !signal.qty || !signal.buy_exchange || !signal.sell_exchange) { res.writeHead(400); res.end('{"error":"missing: pair,qty,buy_exchange,sell_exchange"}'); return; }
    const asset = String(signal.asset || (signal.pair&&signal.pair.split('-')[0]) || '').toUpperCase();
    if (!ALLOWED_SYMBOLS.has(asset+'USDT')) { res.writeHead(400); res.end(JSON.stringify({ ok:false, error:'ASSET_NOT_ALLOWED: only BTC/ETH', code:'ASSET_NOT_ALLOWED' })); return; }
    const t0 = Date.now(); let result;
    try { result = await executeBothLegs(signal); log('INFO','EXEC','OK signal='+signal.signal_id+' mode='+result.mode,{ totalMs:Date.now()-t0 }); }
    catch(e) { const se = (e.message||'').slice(0,200); const ec = e.code||'EXEC_FAILED'; log('ERROR','EXEC','FAILED signal='+signal.signal_id,{ error:se, code:ec, totalMs:Date.now()-t0 }); res.writeHead(500); res.end(JSON.stringify({ ok:false, error:se, code:ec })); reportResult({ signal_id:signal.signal_id, trade_id:signal.trade_id, ok:false, error:se, code:ec }); return; }
    res.writeHead(200); res.end(JSON.stringify(Object.assign({ ok:true }, result)));
    reportResult({ signal_id:signal.signal_id, trade_id:signal.trade_id, ok:true, mode:result.mode, spotOk:result.spotOk, perpOk:result.perpOk, spotOrderId:result.spotOrderId, perpOrderId:result.perpOrderId, symbol:result.symbol, qty:signal.qty, buy_price:signal.buy_price, sell_price:signal.sell_price, net_edge_bps:signal.net_edge_bps, latency:result.latency });
    return;
  }
  if (method === 'POST' && url === '/setup') {
    if (!authCheck(req,res)) return;
    let payload; try { payload = await parseBody(req); } catch { res.writeHead(400); res.end('{"error":"invalid_json"}'); return; }
    const { orderServerCode, envVars } = payload;
    if (!orderServerCode || !envVars) { res.writeHead(400); res.end('{"error":"missing_fields"}'); return; }
    const envContent = Object.entries(envVars).map(([k,v]) => k+'='+v).join('\\n');
    await writeFile('/opt/arb-bot/.env', envContent, 'utf8');
    await writeFile('/opt/arb-bot/order-server.mjs', orderServerCode, 'utf8');
    res.writeHead(200); res.end(JSON.stringify({ status:'setup_complete', ts: new Date().toISOString() }));
    return;
  }
  res.writeHead(404); res.end('{"error":"not_found"}');
});
server.listen(PORT, () => { log('INFO','BOOT','order-server v4 :'+PORT, { env: IS_TESTNET?'testnet':'mainnet', allowed_symbols:[...ALLOWED_SYMBOLS] }); });
`;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const dropletIp = Deno.env.get('DROPLET_IP');
    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const port = Deno.env.get('ORDER_SERVER_PORT') || '4001';

    if (!dropletIp || !dropletSecret) {
      return Response.json({ error: 'DROPLET_IP or DROPLET_SECRET not set' }, { status: 500 });
    }

    // Step 1: Push new code via /setup endpoint (writes order-server.mjs on disk)
    const setupUrl = `http://${dropletIp}:${port}/setup`;
    const setupRes = await fetch(setupUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Droplet-Secret': dropletSecret,
      },
      body: JSON.stringify({ orderServerCode: ORDER_SERVER_CODE }),
      signal: AbortSignal.timeout(15000),
    });

    if (!setupRes.ok) {
      const errText = await setupRes.text().catch(() => '');
      return Response.json({
        error: 'setup_failed',
        status: setupRes.status,
        details: errText.slice(0, 200),
      }, { status: 502 });
    }

    const setupResult = await setupRes.json().catch(() => ({}));

    // Step 2: Restart the service so it picks up the new code
    const restartUrl = `http://${dropletIp}:${port}/restart`;
    let restartOk = false;
    try {
      const restartRes = await fetch(restartUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Droplet-Secret': dropletSecret,
        },
        signal: AbortSignal.timeout(5000),
      });
      restartOk = restartRes.ok;
    } catch {
      // Restart causes the server to exit, so connection may drop — that's expected
      restartOk = true;
    }

    // Step 3: Wait for restart, then health check
    await new Promise(r => setTimeout(r, 4000));

    let healthOk = false;
    let healthData = null;
    try {
      const healthRes = await fetch(`http://${dropletIp}:${port}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (healthRes.ok) {
        healthData = await healthRes.json().catch(() => null);
        healthOk = true;
      }
    } catch {
      // May still be restarting
    }

    return Response.json({
      ok: true,
      setup: setupResult,
      restart_sent: restartOk,
      health_after_restart: healthOk,
      health_data: healthData,
      note: healthOk
        ? 'Order server updated and running with latest code'
        : 'Code pushed and restart sent. Health check failed — may need a few more seconds. Try /health manually.',
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});