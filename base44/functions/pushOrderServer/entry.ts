// pushOrderServer — Pushes the latest order-server.mjs to the droplet
// by writing the file via the /setup endpoint, then restarting via /restart.
// The /setup endpoint writes to bot.mjs, so we also use a direct file-write approach.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// The latest order-server.mjs code — this IS the source of truth.
// Updated 2026-05-20: qtyStep stored as String, roundQtyToStep uses Number().
const ORDER_SERVER_CODE = `// order-server.mjs — Droplet execution server for Basis-Carry v3
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

if (!SECRET || !API_KEY || !API_SECRET) {
  console.error('Missing DROPLET_SECRET, BYBIT_API_KEY, or BYBIT_API_SECRET in .env');
  process.exit(1);
}

function bybitSign(preSign) {
  return createHmac('sha256', API_SECRET).update(preSign).digest('hex');
}

const instrumentCache = new Map();
const INSTRUMENT_TTL_MS = 60 * 60 * 1000;

async function getInstrumentInfo(category, symbol) {
  const key = category + ':' + symbol;
  const cached = instrumentCache.get(key);
  if (cached && (Date.now() - cached.ts) < INSTRUMENT_TTL_MS) return cached;

  const url = BYBIT_BASE + '/v5/market/instruments-info?category=' + category + '&symbol=' + symbol;
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.retCode !== 0) {
    throw new Error('instrument_info_failed ' + category + '/' + symbol + ': ' + ((json && json.retMsg) || res.status));
  }
  const inst = json.result && json.result.list && json.result.list[0];
  if (!inst) throw new Error('instrument_not_found ' + category + '/' + symbol);

  const lot = inst.lotSizeFilter || {};
  // Store as STRING to preserve decimal precision for rounding logic.
  const qtyStepRaw = lot.qtyStep || lot.basePrecision || '0.000001';
  const qtyStep = String(qtyStepRaw);
  const minQty  = parseFloat(lot.minOrderQty || '0');

  const info = { qtyStep: qtyStep, minQty: minQty, ts: Date.now() };
  instrumentCache.set(key, info);
  console.log('[instrument] ' + key + ' qtyStep=' + qtyStep + ' minQty=' + minQty);
  return info;
}

// Round qty DOWN to nearest qtyStep multiple, format as string with proper decimals.
function roundQtyToStep(qty, qtyStep) {
  const step = Number(qtyStep);
  if (!step || step <= 0) return String(qty);
  const rounded = Math.floor(qty / step) * step;
  const stepStr = String(qtyStep);
  const decimals = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
  return rounded.toFixed(decimals);
}

async function bybitOrder(_ref) {
  var category = _ref.category, symbol = _ref.symbol, side = _ref.side, qty = _ref.qty;
  var timestamp  = Date.now().toString();
  var recvWindow = '5000';
  var orderBody  = { category: category, symbol: symbol, side: side, orderType: 'Market', qty: String(qty), timeInForce: 'IOC' };
  if (category === 'spot') orderBody.marketUnit = 'baseCoin';
  var bodyStr    = JSON.stringify(orderBody);
  var preSign    = timestamp + API_KEY + recvWindow + bodyStr;
  var signature  = bybitSign(preSign);

  var res = await fetch(BYBIT_BASE + '/v5/order/create', {
    method: 'POST',
    headers: {
      'X-BAPI-API-KEY': API_KEY,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'Content-Type': 'application/json',
    },
    body: bodyStr,
  });

  var json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error('Bybit HTTP ' + res.status);
  if (json.retCode !== 0) throw new Error('Bybit rejected [' + category + '/' + symbol + '/' + side + ']: ' + json.retMsg + ' (' + json.retCode + ')');
  return { orderId: json.result && json.result.orderId, retCode: json.retCode };
}

async function executeBothLegs(signal) {
  var asset  = String(signal.asset || (signal.pair && signal.pair.split('-')[0]) || 'BTC');
  var symbol = asset + 'USDT';
  var rawQty = Number(signal.qty);
  var buyIsPerp  = /perp|swap|linear/i.test(signal.buy_exchange  || '');
  var sellIsPerp = /perp|swap|linear/i.test(signal.sell_exchange || '');

  if (!buyIsPerp && !sellIsPerp) {
    var isBuyBybit = (signal.buy_exchange || '').toLowerCase().includes('bybit');
    var isSellBybit = (signal.sell_exchange || '').toLowerCase().includes('bybit');
    if (!isBuyBybit && !isSellBybit) throw new Error('no_bybit_leg_cross_venue_spot');
    var spotInfo = await getInstrumentInfo('spot', symbol);
    var spotQty = roundQtyToStep(rawQty, spotInfo.qtyStep);
    if (parseFloat(spotQty) < spotInfo.minQty) throw new Error('spot_qty_below_min ' + symbol);
    var side = isBuyBybit ? 'Buy' : 'Sell';
    console.log('[execute_cross_venue_spot] ' + symbol + ' side=' + side + ' qty=' + spotQty);
    var spotRes = await bybitOrder({ category: 'spot', symbol: symbol, side: side, qty: spotQty });
    return { spotOk: true, perpOk: true, spotOrderId: spotRes.orderId, perpOrderId: null, symbol: symbol, mode: 'live_cross_venue_spot' };
  }

  var spotSide, perpSide;
  if (!buyIsPerp && sellIsPerp) { spotSide = 'Buy'; perpSide = 'Sell'; }
  else if (buyIsPerp && !sellIsPerp) { spotSide = 'Sell'; perpSide = 'Buy'; }
  else { spotSide = 'Buy'; perpSide = 'Sell'; }

  var results = await Promise.all([
    getInstrumentInfo('spot', symbol),
    getInstrumentInfo('linear', symbol),
  ]);
  var spotInfo2 = results[0], perpInfo = results[1];
  var spotQty2 = roundQtyToStep(rawQty, spotInfo2.qtyStep);
  var perpQty = roundQtyToStep(rawQty, perpInfo.qtyStep);
  if (parseFloat(spotQty2) < spotInfo2.minQty) throw new Error('spot_qty_below_min ' + symbol);
  if (parseFloat(perpQty) < perpInfo.minQty) throw new Error('perp_qty_below_min ' + symbol);
  console.log('[execute] ' + symbol + ' spot=' + spotSide + ' perp=' + perpSide + ' qty=' + rawQty);

  var legResults = await Promise.allSettled([
    bybitOrder({ category: 'spot', symbol: symbol, side: spotSide, qty: spotQty2 }),
    bybitOrder({ category: 'linear', symbol: symbol, side: perpSide, qty: perpQty }),
  ]);
  var spotOk = legResults[0].status === 'fulfilled';
  var perpOk = legResults[1].status === 'fulfilled';
  if (!spotOk && !perpOk) throw new Error('both_legs_failed');
  return {
    spotOk: spotOk, perpOk: perpOk,
    spotOrderId: legResults[0].value && legResults[0].value.orderId,
    perpOrderId: legResults[1].value && legResults[1].value.orderId,
    symbol: symbol, mode: spotOk && perpOk ? 'live' : 'live_partial',
  };
}

async function reportResult(payload) {
  if (!RESULT_URL || !TOKEN) return;
  try {
    await fetch(RESULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify(payload),
    });
  } catch (e) { console.error('[reportResult] failed:', e.message); }
}

async function fetchBalance() {
  var timestamp  = Date.now().toString();
  var recvWindow = '5000';
  var preSign    = timestamp + API_KEY + recvWindow + 'accountType=UNIFIED';
  var signature  = bybitSign(preSign);
  var r = await fetch(BYBIT_BASE + '/v5/account/wallet-balance?accountType=UNIFIED', {
    method: 'GET',
    headers: { 'X-BAPI-API-KEY': API_KEY, 'X-BAPI-SIGN': signature, 'X-BAPI-TIMESTAMP': timestamp, 'X-BAPI-RECV-WINDOW': recvWindow },
  });
  var j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error('Bybit HTTP ' + r.status);
  if (j.retCode !== 0) throw new Error('Bybit error: ' + j.retMsg);
  var acct = (j.result && j.result.list && j.result.list[0]) || {};
  return { totalEquity: parseFloat(acct.totalEquity || 0), totalAvailableBalance: parseFloat(acct.totalAvailableBalance || 0), coins: acct.coin || [] };
}

var server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/setup') {
    var secret = req.headers['x-droplet-secret'];
    if (secret !== SECRET) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', async function() {
      try {
        var p = JSON.parse(body);
        if (p.orderServerCode) await writeFile('/opt/arb-bot/order-server.mjs', p.orderServerCode, 'utf8');
        if (p.envVars) {
          var env = Object.entries(p.envVars).map(function(e) { return e[0] + '=' + e[1]; }).join('\\n');
          await writeFile('/opt/arb-bot/.env', env, 'utf8');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'setup_complete', ts: new Date().toISOString() }));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, env: IS_TESTNET ? 'testnet' : 'mainnet', ts: new Date().toISOString() }));
    return;
  }

  if (req.method === 'GET' && req.url && req.url.indexOf('/price') === 0) {
    var authH = req.headers['authorization'] || '';
    if (authH.replace('Bearer ', '').trim() !== SECRET) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
    try {
      var u = new URL(req.url, 'http://x');
      var sym = (u.searchParams.get('symbol') || '').toUpperCase();
      var cat = (u.searchParams.get('category') || 'spot').toLowerCase();
      if (!sym) { res.writeHead(400); res.end('{"error":"missing_symbol"}'); return; }
      var tr = await fetch(BYBIT_BASE + '/v5/market/tickers?category=' + cat + '&symbol=' + sym);
      var tj = await tr.json().catch(() => null);
      if (!tr.ok || !tj || tj.retCode !== 0) { res.writeHead(502); res.end(JSON.stringify({ error: 'ticker_failed' })); return; }
      var price = parseFloat((tj.result && tj.result.list && tj.result.list[0] && tj.result.list[0].lastPrice) || 0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, symbol: sym, category: cat, price: price }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  if (req.method === 'POST' && req.url === '/restart') {
    var s = req.headers['x-droplet-secret'];
    if (s !== SECRET) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'restart_initiated' }));
    setTimeout(function() { process.exit(0); }, 500);
    return;
  }

  if (req.method === 'GET' && (req.url === '/api/balance' || req.url === '/balance')) {
    var ah = req.headers['authorization'] || '';
    var bt = ah.replace('Bearer ', '').trim();
    var sec = req.headers['x-droplet-secret'] || bt;
    if (sec !== SECRET) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
    try {
      var bal = await fetchBalance();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Object.assign({}, bal, { testnet: IS_TESTNET })));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }

  if (req.method === 'POST' && req.url === '/single-order') {
    var aH = req.headers['authorization'] || '';
    if (aH.replace('Bearer ', '').trim() !== SECRET) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
    var body2 = '';
    req.on('data', function(c) { body2 += c; });
    req.on('end', async function() {
      var order;
      try { order = JSON.parse(body2); } catch { res.writeHead(400); res.end('{"error":"invalid_json"}'); return; }
      var sym2 = String(order.symbol || '');
      var side2 = String(order.side || 'Buy');
      var cat2 = String(order.category || 'spot');
      var rq = parseFloat(order.qty);
      if (!sym2 || !rq || rq <= 0) { res.writeHead(400); res.end('{"error":"missing symbol/qty"}'); return; }
      try {
        var info = await getInstrumentInfo(cat2, sym2);
        var q = roundQtyToStep(rq, info.qtyStep);
        if (parseFloat(q) < info.minQty) { res.writeHead(400); res.end(JSON.stringify({ error: 'qty_below_min', min: info.minQty })); return; }
        var result = await bybitOrder({ category: cat2, symbol: sym2, side: side2, qty: q });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, orderId: result.orderId, symbol: sym2, side: side2, category: cat2, qty: q }));
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: (e.message || '').slice(0, 300) })); }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/execute') {
    var aH2 = req.headers['authorization'] || '';
    if (aH2.replace('Bearer ', '').trim() !== SECRET) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
    var body3 = '';
    req.on('data', function(c) { body3 += c; });
    req.on('end', async function() {
      var signal;
      try { signal = JSON.parse(body3); } catch { res.writeHead(400); res.end('{"error":"invalid_json"}'); return; }
      if (!signal.pair || !signal.qty || !signal.buy_exchange || !signal.sell_exchange) { res.writeHead(400); res.end('{"error":"missing_fields"}'); return; }
      var result;
      try {
        result = await executeBothLegs(signal);
        console.log('[execute] OK signal=' + signal.signal_id + ' mode=' + result.mode);
      } catch (e) {
        var err = (e.message || '').slice(0, 200);
        console.error('[execute] FAILED signal=' + signal.signal_id + ':', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err }));
        await reportResult({ signal_id: signal.signal_id, ok: false, error: err });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Object.assign({ ok: true }, result)));
      await reportResult(Object.assign({ signal_id: signal.signal_id, ok: true, qty: signal.qty, buy_price: signal.buy_price, sell_price: signal.sell_price, net_edge_bps: signal.net_edge_bps }, result));
    });
    return;
  }

  res.writeHead(404);
  res.end('{"error":"not_found"}');
});

server.listen(PORT, function() {
  console.log('[order-server] listening on :' + PORT + ' | bybit=' + (IS_TESTNET ? 'testnet' : 'mainnet'));
});
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