// Bybit V5 market order example
// category: "spot" for spot, "linear" for perp

import 'dotenv/config';
import { RestClientV5 } from 'bybit-api';

const client = new RestClientV5({
  key: process.env.BYBIT_API_KEY,
  secret: process.env.BYBIT_API_SECRET,
  testnet: process.env.BYBIT_TESTNET === 'true',
});

const result = await client.placeOrder({
  category: 'spot', // or 'linear' for perp
  symbol: 'BTCUSDT',
  side: 'Buy',
  orderType: 'Market',
  qty: '10',
  marketUnit: 'quoteCoin',
});

console.log(result);