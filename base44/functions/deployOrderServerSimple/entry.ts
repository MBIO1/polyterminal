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

    // Return a simple curl command that fetches and deploys the order-server
    const curlCommand = `ssh root@${dropletIp} 'bash -s' << 'ENDSSH'
cd /opt/arb-bot

# Write .env
cat > .env << 'ENVEOF'
DROPLET_SECRET=${dropletSecret}
BYBIT_API_KEY=${bybitApiKey}
BYBIT_API_SECRET=${bybitApiSecret}
BYBIT_TESTNET=${bybitTestnet}
ORDER_SERVER_PORT=${orderServerPort}
BASE44_RESULT_URL=${baseUrl}/functions/ingestTradeResult
BASE44_USER_TOKEN=${userToken}
ENVEOF

# Download order-server.mjs from GitHub (or use embedded version)
curl -sSL https://raw.githubusercontent.com/your-repo/main/droplet-bot/order-server.mjs -o order-server.mjs || cat > order-server.mjs << 'SCRIPTEOF'
// order-server.mjs — minimal version with cross-venue spot support
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
  console.error('Missing secrets');
  process.exit(1);
}

function bybitSign(preSign) {
  return createHmac('sha256', API_SECRET).update(preSign).digest('hex');
}

async function getInstrumentInfo(category, symbol) {
  const url = \`\${BYBIT_BASE}/v5/market/instruments-info?category=\${category}&symbol=\${symbol}\`;
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.retCode !== 0) throw new Error('instrument_info_failed');
  const inst = json.result?.list?.[0];
  if (!inst) throw new Error('instrument_not_found');
  const lot = inst.lotSizeFilter || {};
  return {
    qtyStep: parseFloat(lot.qtyStep || lot.basePrecision || '0.000001'),
    minQty: parseFloat(lot.minOrderQty || '0'),
  };
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
  if (json.retCode !== 0) throw new Error(\`Bybit rejected: \${json.retMsg}\`);
  return { orderId: json.result?.orderId };
}

async function executeBothLegs(signal) {
  const asset = String(signal.asset || signal.pair?.split('-')[0] || 'BTC');
  const symbol = asset + 'USDT';
  const rawQty = Number(signal.qty);

  const buyIsPerp = /perp|swap|linear/i.test(signal.buy_exchange || '');
  const sellIsPerp = /perp|swap|linear/i.test(signal.sell_exchange || '');

  // Cross-venue spot/spot
  if (!buyIsPerp && !sellIsPerp) {
    const isBuyBybit = signal.buy_exchange?.toLowerCase().includes('bybit');
    const isSellBybit = signal.sell_exchange?.toLowerCase().includes('bybit');
    if (!isBuyBybit && !isSellBybit) throw new Error('no_bybit_leg');

    const spotInfo = await getInstrumentInfo('spot', symbol);
    const spotQty = roundQtyToStep(rawQty, spotInfo.qtyStep);
    if (parseFloat(spotQty) < spotInfo.minQty) throw new Error('qty_below_min');

    const side = isBuyBybit ? 'Buy' : 'Sell';
    const result = await bybitOrder({ category: 'spot', symbol, side, qty: spotQty });
    return { spotOk: true, perpOk: true, spotOrderId: result.orderId, perpOrderId: null, mode: 'live_cross_venue_spot' };
  }

  // Same-venue spot/perp or cross-venue perp/perp
  let spotSide, perpSide;
  if (!buyIsPerp && sellIsPerp) { spotSide = 'Buy'; perpSide = 'Sell'; }
  else if (buyIsPerp && !sellIsPerp) { spotSide = 'Sell'; perpSide = 'Buy'; }
  else { spotSide = 'Buy'; perpSide = 'Sell'; }

  const [spotInfo, perpInfo] = await Promise.all([
    getInstrumentInfo('spot', symbol),
    getInstrumentInfo('linear', symbol),
  ]);

  const spotQty = roundQtyToStep(rawQty, spotInfo.qtyStep);
  const perpQty = roundQtyToStep(rawQty, perpInfo.qtyStep);

  if (parseFloat(spotQty) < spotInfo.minQty || parseFloat(perpQty) < perpInfo.minQty) {
    throw new Error('qty_below_min');
  }

  const [spotRes, perpRes] = await Promise.allSettled([
    bybitOrder({ category: 'spot', symbol, side: spotSide, qty: spotQty }),
    bybitOrder({ category: 'linear', symbol, side: perpSide, qty: perpQty }),
  ]);

  const spotOk = spotRes.status === 'fulfilled';
  const perpOk = perpRes.status === 'fulfilled';

  if (!spotOk && !perpOk) throw new Error('both_legs_failed');

  return {
    spotOk, perpOk,
    spotOrderId: spotRes.value?.orderId,
    perpOrderId: perpRes.value?.orderId,
    mode: spotOk && perpOk ? 'live' : 'live_partial',
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/execute') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (token !== SECRET) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const signal = JSON.parse(body);
        const result = await executeBothLegs(signal);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, env: IS_TESTNET ? 'testnet' : 'mainnet' }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, () => {
  console.log(\`[order-server] listening on :\${PORT}\`);
});
SCRIPTEOF

# Install dependencies if needed
npm init -y > /dev/null 2>&1 || true
npm install ws dotenv --save > /dev/null 2>&1

# Restart service
systemctl daemon-reload
systemctl restart order-server 2>/dev/null || true
pkill -f 'node order-server.mjs' 2>/dev/null || true
cd /opt/arb-bot && nohup node order-server.mjs > /var/log/order-server.log 2>&1 &

echo "Order server restarted successfully"
ENDSSH`;

    return Response.json({
      status: 'ready',
      dropletIp,
      ssh_command: curlCommand,
      instructions: [
        'Run this SSH command from your local machine or bastion host',
        'The command will SSH into the droplet and update order-server.mjs',
        'After running, verify with: curl http://droplet-ip:4001/health',
      ],
    });

  } catch (error) {
    return Response.json({ 
      error: error.message || 'Deployment failed'
    }, { status: 500 });
  }
});