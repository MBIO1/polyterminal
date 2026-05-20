// Serves order-server.mjs as plain text so the droplet can curl it.
// PUBLIC endpoint — no auth required.
// Usage from droplet:
//   curl -s https://polytrade.base44.app/functions/downloadOrderServer -o /opt/arb-bot/order-server.mjs && node /opt/arb-bot/order-server.mjs

const SOURCE = `// order-server.mjs — Droplet execution server for Basis-Carry v3
//
// Receives execute commands from Base44, calls Bybit directly, reports results back.
//
// Required in /opt/arb-bot/.env:
//   DROPLET_SECRET=...        # must match Base44 DROPLET_SECRET secret
//   BYBIT_API_KEY=...
//   BYBIT_API_SECRET=...
//   BYBIT_TESTNET=false       # false = mainnet
//   ORDER_SERVER_PORT=4001
//   BASE44_RESULT_URL=https://polytrade.base44.app/functions/ingestTradeResult
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
  const qtyStep = parseFloat(lot.qtyStep || lot.basePrecision || '0.000001');
  const minQty  = parseFloat(lot.minOrderQty || '0');

  const info = { qtyStep: qtyStep, minQty: minQty, ts: Date.now() };
  instrumentCache.set(key, info);
  console.log('[instrument] ' + key + ' qtyStep=' + qtyStep + ' minQty=' + minQty);
  return info;
}

function roundQtyToStep(qty, qtyStep) {
  if (!qtyStep || qtyStep <= 0) return String(qty);
  const rounded = Math.floor(qty / qtyStep) * qtyStep;
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

  const res = await fetch(BYBIT_BASE + '/v5/order/create', {
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
  if (!res.ok || !json) throw new Error('Bybit HTTP ' + res.status);
  if (json.retCode !== 0) throw new Error('Bybit rejected [' + category + '/' + symbol + '/' + side + ']: ' + json.retMsg + ' (' + json.retCode + ')');
  return { orderId: json.result && json.result.orderId, retCode: json.retCode };
}

async function executeBothLegs(signal) {
  const asset  = String(signal.asset || (signal.pair && signal.pair.split('-')[0]) || 'BTC');
  const symbol = asset + 'USDT';
  const rawQty = Number(signal.qty);

  const buyIsPerp  = /perp|swap|linear/i.test(signal.buy_exchange  || '');
  const sellIsPerp = /perp|swap|linear/i.test(signal.sell_exchange || '');

  let spotSide, perpSide;
  if (!buyIsPerp && sellIsPerp) {
    spotSide = 'Buy';  perpSide = 'Sell';
  } else if (buyIsPerp && !sellIsPerp) {
    spotSide = 'Sell'; perpSide = 'Buy';
  } else {
    spotSide = 'Buy';  perpSide = 'Sell';
  }

  const infoResults = await Promise.all([
    getInstrumentInfo('spot',   symbol),
    getInstrumentInfo('linear', symbol),
  ]);
  const spotInfo = infoResults[0];
  const perpInfo = infoResults[1];

  const spotQty = roundQtyToStep(rawQty, spotInfo.qtyStep);
  const perpQty = roundQtyToStep(rawQty, perpInfo.qtyStep);

  if (parseFloat(spotQty) < spotInfo.minQty) {
    throw new Error('spot_qty_below_min ' + symbol + ': ' + spotQty + ' < ' + spotInfo.minQty);
  }
  if (parseFloat(perpQty) < perpInfo.minQty) {
    throw new Error('perp_qty_below_min ' + symbol + ': ' + perpQty + ' < ' + perpInfo.minQty);
  }

  console.log('[execute] ' + symbol + ' rawQty=' + rawQty + ' spotQty=' + spotQty + ' perpQty=' + perpQty + ' spot=' + spotSide + ' perp=' + perpSide + ' env=' + (IS_TESTNET ? 'testnet' : 'mainnet'));

  const results = await Promise.allSettled([
    bybitOrder({ category: 'spot',   symbol, side: spotSide, qty: spotQty }),
    bybitOrder({ category: 'linear', symbol, side: perpSide, qty: perpQty }),
  ]);

  const spotRes = results[0];
  const perpRes = results[1];
  const spotOk  = spotRes.status === 'fulfilled';
  const perpOk  = perpRes.status === 'fulfilled';

  if (!spotOk && !perpOk) {
    throw new Error('both_legs_failed spot=' + (spotRes.reason && spotRes.reason.message) + ' perp=' + (perpRes.reason && perpRes.reason.message));
  }
  if (!spotOk || !perpOk) {
    console.error('[execute] LEG MISMATCH spot=' + (!spotOk ? (spotRes.reason && spotRes.reason.message) : 'ok') + ' perp=' + (!perpOk ? (perpRes.reason && perpRes.reason.message) : 'ok') + ' — MANUAL REVIEW REQUIRED');
  }

  return {
    spotOk,
    perpOk,
    spotOrderId: spotRes.value && spotRes.value.orderId,
    perpOrderId: perpRes.value && perpRes.value.orderId,
    symbol,
    spotSide,
    perpSide,
    mode: spotOk && perpOk ? 'live' : 'live_partial',
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
  } catch (e) {
    console.error('[reportResult] failed:', e.message);
  }
}

async function fetchBalance() {
  const timestamp  = Date.now().toString();
  const recvWindow = '5000';
  const preSign    = timestamp + API_KEY + recvWindow + 'accountType=UNIFIED';
  const signature  = bybitSign(preSign);

  const r = await fetch(BYBIT_BASE + '/v5/account/wallet-balance?accountType=UNIFIED', {
    method: 'GET',
    headers: {
      'X-BAPI-API-KEY': API_KEY,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
    },
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error('Bybit HTTP ' + r.status);
  if (j.retCode !== 0) throw new Error('Bybit error: ' + j.retMsg + ' (' + j.retCode + ')');
  const acct = (j.result && j.result.list && j.result.list[0]) || {};
  return {
    totalEquity: parseFloat(acct.totalEquity || 0),
    totalAvailableBalance: parseFloat(acct.totalAvailableBalance || 0),
    coins: acct.coin || [],
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, env: IS_TESTNET ? 'testnet' : 'mainnet', ts: new Date().toISOString() }));
    return;
  }

  // Price endpoint — public Bybit ticker proxy. Base44 egress can't reach
  // Bybit directly (geo-block), so it asks the droplet for the price.
  // GET /price?symbol=BTCUSDT&category=spot  ->  { ok, symbol, category, price }
  if (req.method === 'GET' && req.url && req.url.indexOf('/price') === 0) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (token !== SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    try {
      const u = new URL(req.url, 'http://x');
      const symbol   = (u.searchParams.get('symbol')   || '').toUpperCase();
      const category = (u.searchParams.get('category') || 'spot').toLowerCase();
      if (!symbol) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing_symbol' }));
        return;
      }
      const tickerUrl = BYBIT_BASE + '/v5/market/tickers?category=' + category + '&symbol=' + symbol;
      const r = await fetch(tickerUrl);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || j.retCode !== 0) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bybit_ticker_failed', details: (j && j.retMsg) || r.status }));
        return;
      }
      const price = parseFloat((j.result && j.result.list && j.result.list[0] && j.result.list[0].lastPrice) || 0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, symbol: symbol, category: category, price: price }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/balance') {
    const secret = req.headers['x-droplet-secret'];
    if (secret !== SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    try {
      const bal = await fetchBalance();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(Object.assign({}, bal, { testnet: IS_TESTNET })));
    } catch (e) {
      console.error('[balance] failed:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Single-order endpoint — places ONE Bybit market order (spot or linear).
  // Used by placeBybitTestOrder for live execution tests.
  // Body: { symbol, side: "Buy"|"Sell", qty: string, category: "spot"|"linear" }
  if (req.method === 'POST' && req.url === '/single-order') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (token !== SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      let order;
      try { order = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_json' }));
        return;
      }

      const symbol   = String(order.symbol   || '');
      const side     = String(order.side     || 'Buy');
      const category = String(order.category || 'spot');
      const rawQty   = parseFloat(order.qty);

      if (!symbol || !rawQty || rawQty <= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing_or_invalid: symbol, qty' }));
        return;
      }
      if (side !== 'Buy' && side !== 'Sell') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_side (must be Buy or Sell)' }));
        return;
      }
      if (category !== 'spot' && category !== 'linear') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_category (must be spot or linear)' }));
        return;
      }

      try {
        const info = await getInstrumentInfo(category, symbol);
        const qty = roundQtyToStep(rawQty, info.qtyStep);
        if (parseFloat(qty) < info.minQty) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'qty_below_min',
            symbol: symbol, category: category, requested_qty: rawQty, rounded_qty: qty, min_qty: info.minQty,
            hint: 'Increase usd_amount or pick a cheaper asset. Min order = ' + info.minQty + ' ' + symbol.replace('USDT','')
          }));
          return;
        }
        console.log('[single-order] ' + category + ' ' + symbol + ' ' + side + ' qty=' + qty + ' env=' + (IS_TESTNET ? 'testnet' : 'mainnet'));
        const result = await bybitOrder({ category: category, symbol: symbol, side: side, qty: qty });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true, orderId: result.orderId,
          symbol: symbol, side: side, category: category, qty: qty,
          env: IS_TESTNET ? 'testnet' : 'mainnet'
        }));
      } catch (e) {
        const safeErr = (e.message || 'unknown_error').slice(0, 300);
        console.error('[single-order] FAILED ' + category + '/' + symbol + '/' + side + ':', safeErr);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: safeErr }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/execute') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (token !== SECRET) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      console.warn('[execute] unauthorized attempt');
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      let signal;
      try { signal = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_json' }));
        return;
      }

      if (!signal.pair || !signal.qty || !signal.buy_exchange || !signal.sell_exchange) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing_required_fields: pair, qty, buy_exchange, sell_exchange' }));
        return;
      }

      let result;
      try {
        result = await executeBothLegs(signal);
        console.log('[execute] OK signal=' + signal.signal_id + ' trade=' + signal.trade_id + ' mode=' + result.mode);
      } catch (e) {
        const safeErr = (e.message || 'unknown_error').slice(0, 200);
        console.error('[execute] FAILED signal=' + signal.signal_id + ':', safeErr);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: safeErr }));
        reportResult({ signal_id: signal.signal_id, trade_id: signal.trade_id, ok: false, error: safeErr });
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));

      reportResult({
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

  // Deploy bot endpoint — writes bot.mjs + .env, then restarts bot process
  if (req.method === 'POST' && req.url === '/deploy-bot') {
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
        const { writeFileSync, existsSync, mkdirSync } = await import('fs');
        const { execSync } = await import('child_process');

        const payload = JSON.parse(body);
        const { botCode, envVars } = payload;

        const BOT_DIR = '/opt/arb-bot';
        if (!existsSync(BOT_DIR)) mkdirSync(BOT_DIR, { recursive: true });

        // Write bot code
        if (botCode) {
          writeFileSync(BOT_DIR + '/bot.mjs', botCode, 'utf8');
          console.log('[deploy-bot] bot.mjs written (' + botCode.length + ' bytes)');
        }

        // Merge env vars into existing .env (don't wipe existing keys)
        if (envVars && Object.keys(envVars).length > 0) {
          let existingEnv = '';
          try { existingEnv = require('fs').readFileSync(BOT_DIR + '/.env', 'utf8'); } catch {}
          const envMap = {};
          for (const line of existingEnv.split('\\n')) {
            const eq = line.indexOf('=');
            if (eq > 0) envMap[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
          }
          for (const [k, v] of Object.entries(envVars)) {
            if (v !== undefined && v !== null && v !== '') envMap[k] = String(v);
          }
          const envContent = Object.entries(envMap).map(([k, v]) => k + '=' + v).join('\\n');
          writeFileSync(BOT_DIR + '/.env', envContent, 'utf8');
          console.log('[deploy-bot] .env written (' + Object.keys(envMap).length + ' vars)');
        }

        // Restart arb-bot systemd service (or pm2 if systemd not available)
        let restartMsg = '';
        try {
          execSync('systemctl restart arb-bot 2>&1', { timeout: 10000 });
          restartMsg = 'systemctl restart arb-bot: ok';
        } catch {
          try {
            execSync('pm2 restart arb-bot 2>&1', { timeout: 10000 });
            restartMsg = 'pm2 restart arb-bot: ok';
          } catch {
            restartMsg = 'no process manager found — restart manually';
          }
        }
        console.log('[deploy-bot]', restartMsg);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, restart: restartMsg, ts: new Date().toISOString() }));
      } catch (e) {
        console.error('[deploy-bot] error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  console.log('[order-server] listening on :' + PORT + ' | bybit=' + (IS_TESTNET ? 'testnet' : 'mainnet'));
});
`;

Deno.serve(() => {
  return new Response(SOURCE, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
});