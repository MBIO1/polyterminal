import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dropletIp = Deno.env.get('DROPLET_IP');
    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const bybitApiKey = Deno.env.get('BYBIT_API_KEY');
    const bybitApiSecret = Deno.env.get('BYBIT_API_SECRET');
    const bybitTestnet = Deno.env.get('BYBIT_TESTNET') || 'false';
    const orderServerPort = Deno.env.get('ORDER_SERVER_PORT') || '4001';
    const baseUrl = Deno.env.get('BASE44_APP_URL');
    const userToken = Deno.env.get('BASE44_USER_TOKEN');

    if (!dropletIp || !dropletSecret || !bybitApiKey || !bybitApiSecret) {
      return Response.json({ error: 'Missing required secrets' }, { status: 500 });
    }

    const script = `#!/bin/bash
# Cross-Venue Spot Execution Update
# Run this on your droplet to update order-server.mjs

cd /opt/arb-bot

# Backup existing file
cp order-server.mjs order-server.mjs.bak 2>/dev/null || true

# Write updated order-server.mjs with cross-venue spot support
cat > order-server.mjs << 'SCRIPTEOF'
// order-server.mjs — Droplet execution server with cross-venue spot support
import 'dotenv/config';
import { createHmac } from 'crypto';
import http from 'http';

const SECRET = process.env.DROPLET_SECRET;
const API_KEY = process.env.BYBIT_API_KEY;
const API_SECRET = process.env.BYBIT_API_SECRET;
const IS_TESTNET = (process.env.BYBIT_TESTNET || 'false').toLowerCase() !== 'false';
const BYBIT_BASE = IS_TESTNET ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
const PORT = Number(process.env.ORDER_SERVER_PORT || 4001);

if (!SECRET || !API_KEY || !API_SECRET) {
  console.error('Missing DROPLET_SECRET, BYBIT_API_KEY, or BYBIT_API_SECRET');
  process.exit(1);
}

function bybitSign(preSign) {
  return createHmac('sha256', API_SECRET).update(preSign).digest('hex');
}

const instrumentCache = new Map();
const INSTRUMENT_TTL_MS = 60 * 60 * 1000;

async function getInstrumentInfo(category, symbol) {
  const key = \`\${category}:\${symbol}\`;
  const cached = instrumentCache.get(key);
  if (cached && (Date.now() - cached.ts) < INSTRUMENT_TTL_MS) return cached;

  const url = \`\${BYBIT_BASE}/v5/market/instruments-info?category=\${category}&symbol=\${symbol}\`;
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.retCode !== 0) {
    throw new Error(\`instrument_info_failed \${category}/\${symbol}\`);
  }
  const inst = json.result?.list?.[0];
  if (!inst) throw new Error(\`instrument_not_found \${category}/\${symbol}\`);

  const lot = inst.lotSizeFilter || {};
  const qtyStep = parseFloat(lot.qtyStep || lot.basePrecision || '0.000001');
  const minQty = parseFloat(lot.minOrderQty || '0');

  const info = { qtyStep, minQty, ts: Date.now() };
  instrumentCache.set(key, info);
  console.log(\`[instrument] \${key} qtyStep=\${qtyStep} minQty=\${minQty}\`);
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
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const orderBody = { category, symbol, side, orderType: 'Market', qty: String(qty), timeInForce: 'IOC' };
  const bodyStr = JSON.stringify(orderBody);
  const preSign = timestamp + API_KEY + recvWindow + bodyStr;
  const signature = bybitSign(preSign);

  const res = await fetch(\`\${BYBIT_BASE}/v5/order/create\`, {
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
  if (!res.ok || !json) throw new Error(\`Bybit HTTP \${res.status}\`);
  if (json.retCode !== 0) throw new Error(\`Bybit rejected [\${category}/\${symbol}/\${side}]: \${json.retMsg} (\${json.retCode})\`);
  return { orderId: json.result?.orderId, retCode: json.retCode };
}

async function executeBothLegs(signal) {
  const asset = String(signal.asset || signal.pair?.split('-')[0] || 'BTC');
  const symbol = asset + 'USDT';
  const rawQty = Number(signal.qty);

  const buyIsPerp = /perp|swap|linear/i.test(signal.buy_exchange || '');
  const sellIsPerp = /perp|swap|linear/i.test(signal.sell_exchange || '');

  // CROSS-VENUE SPOT/SPOT: Only one leg is on Bybit, execute only that leg
  if (!buyIsPerp && !sellIsPerp) {
    const isBuyBybit = signal.buy_exchange?.toLowerCase().includes('bybit');
    const isSellBybit = signal.sell_exchange?.toLowerCase().includes('bybit');
    
    if (!isBuyBybit && !isSellBybit) {
      throw new Error('no_bybit_leg_cross_venue_spot');
    }

    const spotInfo = await getInstrumentInfo('spot', symbol);
    const spotQty = roundQtyToStep(rawQty, spotInfo.qtyStep);
    
    if (parseFloat(spotQty) < spotInfo.minQty) {
      throw new Error(\`spot_qty_below_min \${symbol}: \${spotQty} < \${spotInfo.minQty}\`);
    }

    const side = isBuyBybit ? 'Buy' : 'Sell';
    console.log(\`[execute_cross_venue_spot] \${symbol} side=\${side} qty=\${spotQty} env=\${IS_TESTNET ? 'testnet' : 'mainnet'}\`);

    const spotRes = await bybitOrder({ category: 'spot', symbol, side, qty: spotQty });
    
    return {
      spotOk: true,
      perpOk: true,
      spotOrderId: spotRes.orderId,
      perpOrderId: null,
      symbol,
      spotSide: side,
      perpSide: null,
      mode: 'live_cross_venue_spot',
    };
  }

  // SAME-VENUE SPOT/PERP or CROSS-VENUE PERP/PERP
  let spotSide, perpSide;
  if (!buyIsPerp && sellIsPerp) {
    spotSide = 'Buy';  perpSide = 'Sell';
  } else if (buyIsPerp && !sellIsPerp) {
    spotSide = 'Sell'; perpSide = 'Buy';
  } else {
    spotSide = 'Buy';  perpSide = 'Sell';
  }

  const [spotInfo, perpInfo] = await Promise.all([
    getInstrumentInfo('spot', symbol),
    getInstrumentInfo('linear', symbol),
  ]);

  const spotQty = roundQtyToStep(rawQty, spotInfo.qtyStep);
  const perpQty = roundQtyToStep(rawQty, perpInfo.qtyStep);

  if (parseFloat(spotQty) < spotInfo.minQty) {
    throw new Error(\`spot_qty_below_min \${symbol}: \${spotQty} < \${spotInfo.minQty}\`);
  }
  if (parseFloat(perpQty) < perpInfo.minQty) {
    throw new Error(\`perp_qty_below_min \${symbol}: \${perpQty} < \${perpInfo.minQty}\`);
  }

  console.log(\`[execute] \${symbol} rawQty=\${rawQty} spotQty=\${spotQty} perpQty=\${perpQty} spot=\${spotSide} perp=\${perpSide} env=\${IS_TESTNET ? 'testnet' : 'mainnet'}\`);

  const [spotRes, perpRes] = await Promise.allSettled([
    bybitOrder({ category: 'spot', symbol, side: spotSide, qty: spotQty }),
    bybitOrder({ category: 'linear', symbol, side: perpSide, qty: perpQty }),
  ]);

  const spotOk = spotRes.status === 'fulfilled';
  const perpOk = perpRes.status === 'fulfilled';

  if (!spotOk && !perpOk) {
    throw new Error(\`both_legs_failed spot=\${spotRes.reason?.message} perp=\${perpRes.reason?.message}\`);
  }
  if (!spotOk || !perpOk) {
    const spotErr = !spotOk ? spotRes.reason?.message : 'ok';
    const perpErr = !perpOk ? perpRes.reason?.message : 'ok';
    console.error(\`[execute] LEG MISMATCH — spot=\${spotErr} perp=\${perpErr} — MANUAL REVIEW REQUIRED\`);
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/execute') {
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
      let signal;
      try { signal = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_json' }));
        return;
      }

      if (!signal.pair || !signal.qty || !signal.buy_exchange || !signal.sell_exchange) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing_required_fields' }));
        return;
      }

      let result;
      try {
        result = await executeBothLegs(signal);
        console.log(\`[execute] OK signal=\${signal.signal_id} mode=\${result.mode}\`);
      } catch (e) {
        const safeErr = e.message?.slice(0, 200) || 'unknown_error';
        console.error(\`[execute] FAILED signal=\${signal.signal_id}:\`, safeErr);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: safeErr }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, env: IS_TESTNET ? 'testnet' : 'mainnet', ts: new Date().toISOString() }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  console.log(\`[order-server] listening on :\${PORT} | bybit=\${IS_TESTNET ? 'testnet' : 'mainnet'}\`);
});
SCRIPTEOF

# Install dependencies
npm init -y > /dev/null 2>&1 || true
npm install ws dotenv --save > /dev/null 2>&1

# Stop existing process
pkill -f 'node order-server.mjs' 2>/dev/null || true
sleep 2

# Start new process
nohup node order-server.mjs > /var/log/order-server.log 2>&1 &
echo "Order server restarted on port $ORDER_SERVER_PORT"

# Verify
sleep 2
curl -s http://localhost:$ORDER_SERVER_PORT/health

echo ""
echo "✅ Order server updated with cross-venue spot execution support"
echo "Check logs: tail -f /var/log/order-server.log"

    return Response.json({
      status: 'ready',
      dropletIp,
      script,
      instructions: [
        'SSH into your droplet: ssh root@' + dropletIp,
        'Paste the entire script block above and press Enter',
        'Wait for "✅ Order server updated" confirmation',
        'Verify: curl http://' + dropletIp + ':' + orderServerPort + '/health',
        'Test execution: trigger a signal from Base44 dashboard',
      ],
    });

  } catch (error) {
    return Response.json({ 
      error: error.message || 'Script generation failed'
    }, { status: 500 });
  }
});