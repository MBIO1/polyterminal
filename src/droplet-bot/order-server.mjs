// order-server.mjs — Droplet execution server for Basis-Carry v3
//
// Receives execute commands from Base44, calls Bybit directly, reports results back.
//
// Setup:
//   npm install ws dotenv
//   node order-server.mjs
//
// Env vars (add to /opt/arb-bot/.env):
//   DROPLET_SECRET=your-shared-secret   # must match Base44 DROPLET_SECRET
//   BYBIT_API_KEY=...
//   BYBIT_API_SECRET=...
//   BYBIT_TESTNET=false                 # false = mainnet
//   ORDER_SERVER_PORT=4001
//   BASE44_RESULT_URL=https://YOUR_APP.base44.app/functions/ingestTradeResult
//   BASE44_USER_TOKEN=...

import 'dotenv/config';
import { createHmac } from 'crypto';
import http from 'http';

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

// ─── Bybit signing ────────────────────────────────────────────────────────────

function bybitSign(preSign) {
  return createHmac('sha256', API_SECRET).update(preSign).digest('hex');
}

// ─── Instrument-info cache (qty/price precision) ──────────────────────────────
// Bybit v5 /v5/market/instruments-info — public, no auth needed.
// Cache for 1h per category:symbol. Returns { qtyStep, minQty }.

const instrumentCache = new Map(); // key: `${category}:${symbol}` → { qtyStep, minQty, ts }
const INSTRUMENT_TTL_MS = 60 * 60 * 1000;

async function getInstrumentInfo(category, symbol) {
  const key = `${category}:${symbol}`;
  const cached = instrumentCache.get(key);
  if (cached && (Date.now() - cached.ts) < INSTRUMENT_TTL_MS) return cached;

  const url = `${BYBIT_BASE}/v5/market/instruments-info?category=${category}&symbol=${symbol}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.retCode !== 0) {
    throw new Error(`instrument_info_failed ${category}/${symbol}: ${json?.retMsg || res.status}`);
  }
  const inst = json.result?.list?.[0];
  if (!inst) throw new Error(`instrument_not_found ${category}/${symbol}`);

  // Spot uses basePrecision; linear uses qtyStep. Both indicate qty step size.
  const lot = inst.lotSizeFilter || {};
  const qtyStep = parseFloat(lot.qtyStep || lot.basePrecision || '0.000001');
  const minQty  = parseFloat(lot.minOrderQty || '0');

  const info = { qtyStep, minQty, ts: Date.now() };
  instrumentCache.set(key, info);
  console.log(`[instrument] ${key} qtyStep=${qtyStep} minQty=${minQty}`);
  return info;
}

// Round qty DOWN to nearest qtyStep multiple, format as string with proper decimals.
function roundQtyToStep(qty, qtyStep) {
  if (!qtyStep || qtyStep <= 0) return String(qty);
  const rounded = Math.floor(qty / qtyStep) * qtyStep;
  // Decimal places implied by qtyStep (e.g. 0.01 → 2, 1 → 0)
  const stepStr = qtyStep.toString();
  const decimals = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
  return rounded.toFixed(decimals);
}

async function bybitOrder({ category, symbol, side, qty }) {
  const timestamp  = Date.now().toString();
  const recvWindow = '5000';
  const orderBody  = { category, symbol, side, orderType: 'Market', qty: String(qty), timeInForce: 'IOC' };
  const bodyStr    = JSON.stringify(orderBody);
  const preSign    = timestamp + API_KEY + recvWindow + bodyStr;
  const signature  = bybitSign(preSign);

  const res = await fetch(`${BYBIT_BASE}/v5/order/create`, {
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

  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(`Bybit HTTP ${res.status}`);
  if (json.retCode !== 0) throw new Error(`Bybit rejected [${category}/${symbol}/${side}]: ${json.retMsg} (${json.retCode})`);
  return { orderId: json.result?.orderId, retCode: json.retCode };
}

// ─── Execute both legs ────────────────────────────────────────────────────────

async function executeBothLegs(signal) {
  const asset  = String(signal.asset || signal.pair?.split('-')[0] || 'BTC');
  const symbol = asset + 'USDT';
  const rawQty = Number(signal.qty);

  const buyIsPerp  = /perp|swap|linear/i.test(signal.buy_exchange  || '');
  const sellIsPerp = /perp|swap|linear/i.test(signal.sell_exchange || '');

  let spotSide, perpSide;
  if (!buyIsPerp && sellIsPerp) {
    spotSide = 'Buy';  perpSide = 'Sell';  // contango
  } else if (buyIsPerp && !sellIsPerp) {
    spotSide = 'Sell'; perpSide = 'Buy';   // backwardation
  } else {
    spotSide = 'Buy';  perpSide = 'Sell';  // fallback
  }

  // Fetch lot-size info for both legs and round qty to each step.
  const [spotInfo, perpInfo] = await Promise.all([
    getInstrumentInfo('spot',   symbol),
    getInstrumentInfo('linear', symbol),
  ]);

  const spotQty = roundQtyToStep(rawQty, spotInfo.qtyStep);
  const perpQty = roundQtyToStep(rawQty, perpInfo.qtyStep);

  if (parseFloat(spotQty) < spotInfo.minQty) {
    throw new Error(`spot_qty_below_min ${symbol}: ${spotQty} < ${spotInfo.minQty}`);
  }
  if (parseFloat(perpQty) < perpInfo.minQty) {
    throw new Error(`perp_qty_below_min ${symbol}: ${perpQty} < ${perpInfo.minQty}`);
  }

  console.log(`[execute] ${symbol} rawQty=${rawQty} spotQty=${spotQty} perpQty=${perpQty} spot=${spotSide} perp=${perpSide} env=${IS_TESTNET ? 'testnet' : 'mainnet'}`);

  const [spotRes, perpRes] = await Promise.allSettled([
    bybitOrder({ category: 'spot',   symbol, side: spotSide, qty: spotQty }),
    bybitOrder({ category: 'linear', symbol, side: perpSide, qty: perpQty }),
  ]);

  const spotOk = spotRes.status === 'fulfilled';
  const perpOk = perpRes.status === 'fulfilled';

  if (!spotOk && !perpOk) {
    throw new Error(`both_legs_failed spot=${spotRes.reason?.message} perp=${perpRes.reason?.message}`);
  }
  if (!spotOk || !perpOk) {
    const spotErr = !spotOk ? spotRes.reason?.message : 'ok';
    const perpErr = !perpOk ? perpRes.reason?.message : 'ok';
    console.error(`[execute] LEG MISMATCH — spot=${spotErr} perp=${perpErr} — MANUAL REVIEW REQUIRED`);
  }

  return {
    spotOk,
    perpOk,
    spotOrderId: spotRes.value?.orderId,
    perpOrderId: perpRes.value?.orderId,
    symbol,
    spotSide,
    perpSide,
    mode: spotOk && perpOk ? 'live' : 'live_partial',
  };
}

// ─── Report result back to Base44 ────────────────────────────────────────────

async function reportResult(payload) {
  if (!RESULT_URL || !TOKEN) return;
  try {
    await fetch(RESULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('[reportResult] failed:', e.message);
  }
}

// ─── Fetch wallet balance ─────────────────────────────────────────────────────

async function fetchBalance() {
  const timestamp  = Date.now().toString();
  const recvWindow = '5000';
  const preSign    = timestamp + API_KEY + recvWindow;
  const signature  = bybitSign(preSign);

  const res = await fetch(`${BYBIT_BASE}/v5/account/wallet-balance`, {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': API_KEY,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
    },
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

const server = http.createServer(async (req, res) => {
  // Setup endpoint — receives order-server code and env vars from Base44
  if (req.method === 'POST' && req.url === '/setup') {
    const secret = req.headers['x-droplet-secret'];
    if (secret !== SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const { orderServerCode, envVars } = payload;

        if (!orderServerCode || !envVars) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing_orderServerCode_or_envVars' }));
          return;
        }

        // Write .env file
        const envContent = Object.entries(envVars)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n');
        
        await Deno.writeTextFile('/opt/arb-bot/.env', envContent);

        // Write order-server.mjs
        await Deno.writeTextFile('/opt/arb-bot/order-server.mjs', orderServerCode);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'setup_complete',
          message: 'Order server code and env configured',
          ts: new Date().toISOString()
        }));
      } catch (e) {
        console.error('[setup] error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, env: IS_TESTNET ? 'testnet' : 'mainnet', ts: new Date().toISOString() }));
    return;
  }

  // Restart endpoint
  if (req.method === 'POST' && req.url === '/restart') {
    const secret = req.headers['x-droplet-secret'];
    if (secret !== SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'restart_initiated', ts: new Date().toISOString() }));
    
    // Graceful shutdown and restart
    setTimeout(() => {
      console.log('[restart] initiating restart...');
      process.exit(0);
    }, 500);
    return;
  }

  // Balance endpoint
  if (req.method === 'GET' && req.url === '/api/balance') {
    const secret = req.headers['x-droplet-secret'];
    if (secret !== SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    try {
      const balance = await fetchBalance();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...balance, testnet: IS_TESTNET }));
    } catch (e) {
      console.error('[balance] failed:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Execute endpoint
  if (req.method === 'POST' && req.url === '/execute') {
    // Auth check
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (token !== SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      console.warn('[execute] unauthorized attempt');
      return;
    }

    // Parse body
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      let signal;
      try {
        signal = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_json' }));
        return;
      }

      // Validate required fields
      if (!signal.pair || !signal.qty || !signal.buy_exchange || !signal.sell_exchange) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing_required_fields: pair, qty, buy_exchange, sell_exchange' }));
        return;
      }

      // Execute
      let result;
      try {
        result = await executeBothLegs(signal);
        console.log(`[execute] OK signal=${signal.signal_id} trade=${signal.trade_id} mode=${result.mode}`);
      } catch (e) {
        const safeErr = e.message?.slice(0, 200) || 'unknown_error';
        console.error(`[execute] FAILED signal=${signal.signal_id}:`, safeErr);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: safeErr }));
        // Report failure back to Base44
        await reportResult({ signal_id: signal.signal_id, trade_id: signal.trade_id, ok: false, error: safeErr });
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));

      // Report success back to Base44 (async, after responding)
      await reportResult({
        signal_id:    signal.signal_id,
        trade_id:     signal.trade_id,
        ok:           true,
        mode:         result.mode,
        spotOk:       result.spotOk,
        perpOk:       result.perpOk,
        spotOrderId:  result.spotOrderId,
        perpOrderId:  result.perpOrderId,
        symbol:       result.symbol,
        qty:          signal.qty,
        buy_price:    signal.buy_price,
        sell_price:   signal.sell_price,
        net_edge_bps: signal.net_edge_bps,
      });
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  console.log(`[order-server] listening on :${PORT} | bybit=${IS_TESTNET ? 'testnet' : 'mainnet'}`);
});