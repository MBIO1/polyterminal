/**
 * MBIO Order Server — Production
 * Runs on port 4001 on the droplet.
 *
 * Required .env:
 *   BYBIT_API_KEY
 *   BYBIT_API_SECRET
 *   BYBIT_TESTNET  (true/false)
 *   ORDER_SERVER_PORT (default 4001)
 */

import 'dotenv/config';
import http from 'http';
import { RestClientV5 } from 'bybit-api';

const PORT = process.env.ORDER_SERVER_PORT || 4001;

const client = new RestClientV5({
  key:     process.env.BYBIT_API_KEY,
  secret:  process.env.BYBIT_API_SECRET,
  testnet: process.env.BYBIT_TESTNET === 'true',
  recv_window: 5000,
});

// Helper functions for order placement
async function placeMarketOrder(client, asset, exchange, side, qty, price) {
  const category = 'spot';
  const symbol = asset.replace('-USDT', '') + 'USDT';
  
  try {
    const orderParams = {
      category,
      symbol,
      side,
      orderType: 'Market',
      qty: qty.toFixed(6),
      marketUnit: side === 'Buy' ? 'quoteCoin' : 'baseCoin',
    };

    const result = await client.placeOrder(orderParams);
    
    if (result.retCode !== 0) {
      console.error(`[ORDER] ${category} ${side} API error:`, result.retMsg);
      throw new Error(`${category} ${side}: ${result.retMsg}`);
    }
    
    const orderId = result.result?.orderId || null;
    console.log(`[ORDER] ✅ ${category} ${side} ${symbol} qty=${qty} orderId=${orderId}`);
    return { orderId, symbol, category, executedQty: result.result?.executedQty || '0' };
  } catch (err) {
    console.error(`[ORDER] ❌ ${category} ${side} failed:`, err.message);
    throw err;
  }
}

async function placePerpOrder(client, asset, exchange, side, qty, price) {
  const category = 'linear';
  const symbol = asset.replace('-USDT', '') + 'USDT';
  
  try {
    const orderParams = {
      category,
      symbol,
      side,
      orderType: 'Market',
      qty: qty.toFixed(4),
    };

    const result = await client.placeOrder(orderParams);
    
    if (result.retCode !== 0) {
      console.error(`[ORDER] ${category} ${side} API error:`, result.retMsg);
      throw new Error(`${category} ${side}: ${result.retMsg}`);
    }
    
    const orderId = result.result?.orderId || null;
    console.log(`[ORDER] ✅ ${category} ${side} ${symbol} qty=${qty} orderId=${orderId}`);
    return { orderId, symbol, category, executedQty: result.result?.executedQty || '0' };
  } catch (err) {
    console.error(`[ORDER] ❌ ${category} ${side} failed:`, err.message);
    throw err;
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  res.setHeader('Content-Type', 'application/json');

  if (url === '/health' || url === '/') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'online', engine: 'bybit-v5', ts: Date.now() }));
    return;
  }

  if (url === '/balance') {
    try {
      const raw = await client.getWalletBalance({ accountType: 'UNIFIED' });
      const account = raw.result?.list?.[0] || {};
      res.writeHead(200);
      res.end(JSON.stringify({
        totalEquity:            parseFloat(account.totalEquity || 0),
        totalAvailableBalance:  parseFloat(account.totalAvailableBalance || 0),
        totalWalletBalance:     parseFloat(account.totalWalletBalance || 0),
        testnet:                process.env.BYBIT_TESTNET === 'true',
        coins: (account.coin || []).map(c => ({
          coin:              c.coin,
          equity:            parseFloat(c.equity || 0),
          walletBalance:     parseFloat(c.walletBalance || 0),
          availableBalance:  parseFloat(c.availableToWithdraw || 0),
          usdValue:          parseFloat(c.usdValue || 0),
        })).filter(c => c.usdValue > 0.01),
      }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url === '/execute' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const payload = JSON.parse(body);
      const { signal_id, pair, asset, buy_exchange, sell_exchange, buy_price, sell_price, qty } = payload;
      
      // Determine order sides
      const buyIsPerp = /perp|swap|futures/i.test(buy_exchange);
      const sellIsPerp = /perp|swap|futures/i.test(sell_exchange);

      console.log(`\n[EXEC] ========== EXECUTION REQUEST ==========`);
      console.log(`[EXEC] Signal: ${signal_id} | Pair: ${pair} | Asset: ${asset}`);
      console.log(`[EXEC] Qty: ${qty} | Buy: ${buy_exchange}@${buy_price} | Sell: ${sell_exchange}@${sell_price}`);
      console.log(`[EXEC] Strategy: buyIsPerp=${buyIsPerp} sellIsPerp=${sellIsPerp}`);
      
      // Execute both legs based on strategy type
      let spotResult = null, perpResult = null;
      let spotOk = false, perpOk = false;
      let errors = [];
      
      try {
        if (buyIsPerp && sellIsPerp) {
          // Perp/Perp cross-venue
          console.log(`[EXEC] Strategy: Perp/Perp - Buy ${buy_exchange}, Sell ${sell_exchange}`);
          const [buyResult, sellResult] = await Promise.all([
            placePerpOrder(client, asset, buy_exchange, 'Buy', qty, buy_price),
            placePerpOrder(client, asset, sell_exchange, 'Sell', qty, sell_price),
          ]);
          perpResult = { buy: buyResult, sell: sellResult };
          spotOk = true;
          perpOk = !!buyResult && !!sellResult;
        } else if (!buyIsPerp && !sellIsPerp) {
          // Spot/Spot cross-venue
          console.log(`[EXEC] Strategy: Spot/Spot - Buy ${buy_exchange}, Sell ${sell_exchange}`);
          const [buyResult, sellResult] = await Promise.all([
            placeMarketOrder(client, asset, buy_exchange, 'Buy', qty, buy_price),
            placeMarketOrder(client, asset, sell_exchange, 'Sell', qty, sell_price),
          ]);
          spotResult = { buy: buyResult, sell: sellResult };
          spotOk = !!buyResult && !!sellResult;
          perpOk = true;
        } else {
          // Same-venue Spot/Perp carry
          console.log(`[EXEC] Strategy: Spot/Perp Carry - Buy ${buy_exchange}, Sell ${sell_exchange}`);
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
      } catch (err) {
        errors.push(err.message);
        console.error(`[EXEC] Order execution error:`, err.message);
      }
      
      console.log(`[EXEC] ✅ SUCCESS: spotOk=${spotOk} perpOk=${perpOk}`);
      if (spotResult) console.log(`[EXEC]   Spot orders:`, JSON.stringify(spotResult));
      if (perpResult) console.log(`[EXEC]   Perp orders:`, JSON.stringify(perpResult));
      
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        spotOk,
        perpOk,
        spotOrderId: spotResult?.buy?.orderId || spotResult?.orderId,
        perpOrderId: perpResult?.buy?.orderId || perpResult?.orderId,
        mode: process.env.BYBIT_TESTNET === 'true' ? 'testnet' : 'live',
        errors: errors.length > 0 ? errors : undefined,
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

server.listen(PORT, () => {
  console.log(`✅ Order server listening on port ${PORT}`);
});