// updateOrderServer — returns a self-contained bash script that writes
// order-server.mjs locally on the droplet (via heredoc) and restarts the service.
//
// Avoids depending on the public /functions/downloadOrderServer route, which
// may be blocked by the app's domain config ("App not found" 404).

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Keep the source as a single string. Use a sentinel ('OSEOF') as the bash
// heredoc delimiter — that string must NOT appear anywhere inside SOURCE.
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

// HARD NOTIONAL CAP — last-line defense. Any single order > $100 USD is rejected
// regardless of what Base44 sends. Override via MAX_ORDER_USD env if needed.
const MAX_ORDER_USD = Number(process.env.MAX_ORDER_USD || 100);

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
  // HARD NOTIONAL CAP — fetch current price and reject if qty*price > MAX_ORDER_USD.
  try {
    const tickRes  = await fetch(BYBIT_BASE + '/v5/market/tickers?category=' + category + '&symbol=' + symbol);
    const tickJson = await tickRes.json().catch(() => null);
    const lastPx   = parseFloat((tickJson && tickJson.result && tickJson.result.list && tickJson.result.list[0] && tickJson.result.list[0].lastPrice) || 0);
    const notional = parseFloat(qty) * lastPx;
    if (lastPx > 0 && notional > MAX_ORDER_USD) {
      throw new Error('hard_notional_cap_exceeded: $' + notional.toFixed(2) + ' > $' + MAX_ORDER_USD + ' (' + category + '/' + symbol + '/' + side + ' qty=' + qty + ' px=' + lastPx + ')');
    }
    console.log('[bybitOrder] notional check ok: $' + notional.toFixed(2) + ' <= $' + MAX_ORDER_USD);
  } catch (e) {
    if (e.message && e.message.indexOf('hard_notional_cap_exceeded') === 0) throw e;
    console.warn('[bybitOrder] notional precheck failed (allowing order):', e.message);
  }

  const timestamp  = Date.now().toString();
  const recvWindow = '5000';
  const orderBody  = { category, symbol, side, orderType: 'Market', qty: String(qty), timeInForce: 'IOC' };
  // Spot market orders default to quote-coin qty. We always pass base-coin qty,
  // so force marketUnit=baseCoin on spot to match. Linear ignores this field.
  if (category === 'spot') orderBody.marketUnit = 'baseCoin';
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

  // Price proxy — Base44 egress is geo-blocked from Bybit, so it asks the droplet.
  // GET /price?symbol=BTCUSDT&category=spot
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

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  console.log('[order-server] listening on :' + PORT + ' | bybit=' + (IS_TESTNET ? 'testnet' : 'mainnet') + ' | MAX_ORDER_USD=$' + MAX_ORDER_USD);
});
`;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const dropletIp = Deno.env.get('DROPLET_IP') || 'YOUR_DROPLET_IP';

    // Build a self-contained bash script that writes the file via heredoc,
    // then restarts via systemd or pm2. No outbound HTTP from the droplet needed.
    const fullScript = `#!/bin/bash
set -e

mkdir -p /opt/arb-bot

echo "=== Writing /opt/arb-bot/order-server.mjs ==="
cat > /opt/arb-bot/order-server.mjs << 'OSEOF'
${SOURCE}OSEOF

echo "✅ File written ($(wc -l < /opt/arb-bot/order-server.mjs) lines)"

echo ""
echo "=== Restarting order-server ==="
if systemctl is-active --quiet order-server 2>/dev/null; then
  systemctl restart order-server
  echo "✅ Restarted via systemd"
elif pm2 list 2>/dev/null | grep -q order-server; then
  pm2 restart order-server
  echo "✅ Restarted via pm2"
else
  cd /opt/arb-bot && pm2 start order-server.mjs --name order-server
  echo "✅ Started via pm2 (first time)"
fi

sleep 2
echo ""
echo "=== Health check ==="
curl -s http://localhost:4001/health
echo ""
echo "=== Done — /single-order endpoint now live ==="
`;

    return Response.json({
      status: 'ready',
      message: 'Self-contained deploy script — no public URL pull needed',
      script: fullScript,
      instructions: [
        '1. SSH into your droplet: ssh root@' + dropletIp,
        '2. Paste the FULL script below and run it',
        '3. Verify /health responds with ok:true',
        '4. Then click "Place $1 Bybit Order" on the Health page',
      ],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});