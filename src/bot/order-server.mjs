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
});

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
      // Normalize to the shape getBybitBalance expects
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

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found', url }));
});

server.listen(PORT, () => {
  console.log(`✅ Order server listening on port ${PORT}`);
});