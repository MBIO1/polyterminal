import http from 'http';
import { RESTClientV5, WebsocketClient } from 'bybit-api';
import dotenv from 'dotenv';
dotenv.config();

const {
  BYBIT_API_KEY,
  BYBIT_API_SECRET,
  BYBIT_TESTNET,
  ORDER_SERVER_PORT = 4001,
} = process.env;

console.log('[CONFIG] Starting order server...', {
  testnet: BYBIT_TESTNET === 'true',
  port: ORDER_SERVER_PORT,
  hasApiKey: !!BYBIT_API_KEY,
});

const client = new RESTClientV5({
  key: BYBIT_API_KEY,
  secret: BYBIT_API_SECRET,
  testnet: BYBIT_TESTNET === 'true',
});

const wsClient = new WebsocketClient({
  key: BYBIT_API_KEY,
  secret: BYBIT_API_SECRET,
  testnet: BYBIT_TESTNET === 'true',
});

// Helper functions for order placement
async function placeMarketOrder(client, asset, exchange, side, qty, price) {
  const category = 'spot';
  const symbol = asset.replace('-USDT', '') + 'USDT';
  
  try {
    const result = await client.placeOrder({
      category,
      symbol,
      side,
      orderType: 'Market',
      qty: qty.toString(),
      marketUnit: 'USDT',
    });
    
    if (result.retCode !== 0) {
      throw new Error(`${category} ${side}: ${result.retMsg}`);
    }
    
    return { orderId: result.result.orderId, symbol, category };
  } catch (err) {
    console.error(`[ORDER] ${category} ${side} failed:`, err.message);
    throw err;
  }
}

async function placePerpOrder(client, asset, exchange, side, qty, price) {
  const category = 'linear';
  const symbol = asset.replace('-USDT', '') + 'USDT';
  
  try {
    const result = await client.placeOrder({
      category,
      symbol,
      side,
      orderType: 'Market',
      qty: qty.toString(),
    });
    
    if (result.retCode !== 0) {
      throw new Error(`${category} ${side}: ${result.retMsg}`);
    }
    
    return { orderId: result.result.orderId, symbol, category };
  } catch (err) {
    console.error(`[ORDER] ${category} ${side} failed:`, err.message);
    throw err;
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  res.setHeader('Content-Type', 'application/json');

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Droplet-Secret');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      testnet: BYBIT_TESTNET === 'true',
    }));
    return;
  }

  // Balance endpoint
  if (url === '/balance' && req.method === 'GET') {
    try {
      const raw = await client.getWalletBalance({ accountType: 'UNIFIED' });
      const account = raw.result?.list?.[0] || {};
      res.writeHead(200);
      res.end(JSON.stringify({
        totalEquity:            parseFloat(account.totalEquity || 0),
        totalAvailableBalance:  parseFloat(account.totalAvailableBalance || 0),
        totalWalletBalance:     parseFloat(account.totalWalletBalance || 0),
        testnet:                BYBIT_TESTNET === 'true',
        coins: (account.coin || []).map(c => ({
          coin:              c.coin,
          equity:            parseFloat(c.equity || 0),
          walletBalance:     parseFloat(c.walletBalance || 0),
          availableBalance:  parseFloat(c.availableToWithdraw || 0),
          usdValue:          parseFloat(c.usdValue || 0),
        })).filter(c => c.usdValue > 0.01),
      }));
    } catch (err) {
      console.error('[BALANCE] Error:', err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Execute endpoint
  if (url === '/execute' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const payload = JSON.parse(body);
      const { signal_id, pair, asset, buy_exchange, sell_exchange, buy_price, sell_price, qty } = payload;
      
      console.log(`\n[EXEC] ========== EXECUTION REQUEST ==========`);
      console.log(`[EXEC] Signal: ${signal_id} | Pair: ${pair} | Asset: ${asset}`);
      console.log(`[EXEC] Qty: ${qty} | Buy: ${buy_exchange}@${buy_price} | Sell: ${sell_exchange}@${sell_price}`);
      console.log(`[EXEC] Strategy: buyIsPerp=${buyIsPerp} sellIsPerp=${sellIsPerp}`);
      
      const buyIsPerp = /perp|swap|futures/i.test(buy_exchange);
      const sellIsPerp = /perp|swap|futures/i.test(sell_exchange);
      
      let spotResult = null, perpResult = null;
      let spotOk = false, perpOk = false;
      
      if (buyIsPerp && sellIsPerp) {
        // Perp/Perp cross-venue
        const [buyResult, sellResult] = await Promise.all([
          placePerpOrder(client, asset, buy_exchange, 'Buy', qty, buy_price),
          placePerpOrder(client, asset, sell_exchange, 'Sell', qty, sell_price),
        ]);
        perpResult = { buy: buyResult, sell: sellResult };
        spotOk = true;
        perpOk = !!buyResult && !!sellResult;
      } else if (!buyIsPerp && !sellIsPerp) {
        // Spot/Spot cross-venue
        const [buyResult, sellResult] = await Promise.all([
          placeMarketOrder(client, asset, buy_exchange, 'Buy', qty, buy_price),
          placeMarketOrder(client, asset, sell_exchange, 'Sell', qty, sell_price),
        ]);
        spotResult = { buy: buyResult, sell: sellResult };
        spotOk = !!buyResult && !!sellResult;
        perpOk = true;
      } else {
        // Same-venue Spot/Perp carry
        const [spotOrder, perpOrder] = await Promise.all([
          buyIsPerp ? placePerpOrder(client, asset, buy_exchange, 'Buy', qty, buy_price) : placeMarketOrder(client, asset, buy_exchange, 'Buy', qty, buy_price),
          sellIsPerp ? placePerpOrder(client, asset, sell_exchange, 'Sell', qty, sell_price) : placeMarketOrder(client, asset, sell_exchange, 'Sell', qty, sell_price),
        ]);
        if (buyIsPerp) {
          perpResult = spotOrder;
          spotResult = perpOrder;
        } else {
          spotResult = spotOrder;
          perpResult = perpOrder;
        }
        spotOk = !!spotResult;
        perpOk = !!perpResult;
      }
      
      console.log(`[EXEC] ✅ SUCCESS: spotOk=${spotOk} perpOk=${perpOk}`);
      if (spotResult) console.log(`[EXEC]   Spot orders:`, spotResult);
      if (perpResult) console.log(`[EXEC]   Perp orders:`, perpResult);
      
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        spotOk,
        perpOk,
        spotOrderId: spotResult?.buy?.orderId || spotResult?.orderId,
        perpOrderId: perpResult?.buy?.orderId || perpResult?.orderId,
        mode: BYBIT_TESTNET === 'true' ? 'testnet' : 'live',
      }));
    } catch (err) {
      console.error(`[EXEC] ❌ FAILED:`, err.message);
      console.error('[EXEC] Stack:', err.stack);
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: err.message, stack: err.stack }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found', url }));
});

const PORT = parseInt(ORDER_SERVER_PORT, 10) || 4001;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Order server listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('[SERVER] Server closed');
    process.exit(0);
  });
});