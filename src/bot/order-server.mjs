/**
 * MBIO Order Server — Production
 * Runs on port 4001 on the droplet.
 * Provides Bybit account balance and order execution endpoints.
 *
 * Required .env:
 *   BYBIT_API_KEY
 *   BYBIT_API_SECRET
 *   BYBIT_TESTNET  (set to "true" for testnet)
 *
 * Run: pm2 start order-server.mjs --name order-server
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
  const url = req.url.split('?')[0]; // strip query string

  res.setHeader('Content-Type', 'application/json');

  if (url === '/health' || url === '/') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'online', engine: 'bybit-v5', ts: Date.now() }));
    return;
  }

  if (url === '/balance') {
    try {
      const bal = await client.getWalletBalance({ accountType: 'UNIFIED' });
      res.writeHead(200);
      res.end(JSON.stringify(bal.result));
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