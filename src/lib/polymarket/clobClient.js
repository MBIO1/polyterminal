/**
 * Polymarket CLOB API Client
 *
 * Wraps the Polymarket Central Limit Order Book REST API.
 * All write operations (place / cancel order) require signed auth headers.
 * Read operations (prices, markets) are public.
 *
 * Base URL: https://clob.polymarket.com
 * Docs: https://docs.polymarket.com/trading/overview
 */

import { buildRestAuthHeaders, buildAndSignOrder, SIDE } from './eip712.js';

const CLOB_BASE = 'https://clob.polymarket.com';

// ── Shared fetch wrapper ───────────────────────────────────────────────────────
async function clobFetch(path, options = {}) {
  const url = `${CLOB_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`CLOB ${options.method || 'GET'} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC (no auth required)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch live order book for a token (YES or NO side).
 * @param {string} tokenId - Polymarket token ID
 */
export async function getOrderBook(tokenId) {
  return clobFetch(`/book?token_id=${tokenId}`);
}

/**
 * Fetch best bid/ask midpoint price for a token.
 * @param {string} tokenId
 * @returns {Promise<{price: number, bid: number, ask: number}>}
 */
export async function getMidpointPrice(tokenId) {
  const data = await clobFetch(`/midpoint?token_id=${tokenId}`);
  const price = parseFloat(data.mid || 0);
  const bid   = parseFloat(data.best_bid || price);
  const ask   = parseFloat(data.best_ask || price);
  return { price, bid, ask };
}

/**
 * Fetch spread and price for a token.
 * @param {string} tokenId
 */
export async function getSpread(tokenId) {
  return clobFetch(`/spread?token_id=${tokenId}`);
}

/**
 * Fetch open markets from the CLOB (paginated).
 * @param {number} limit
 * @param {number} offset
 */
export async function getMarkets(limit = 20, offset = 0) {
  return clobFetch(`/markets?limit=${limit}&offset=${offset}`);
}

/**
 * Fetch a single market's info by condition ID.
 * @param {string} conditionId
 */
export async function getMarketInfo(conditionId) {
  return clobFetch(`/markets/${conditionId}`);
}

/**
 * Fetch recent trade history for a token.
 * @param {string} tokenId
 * @param {number} limit
 */
export async function getTradeHistory(tokenId, limit = 50) {
  return clobFetch(`/trades?token_id=${tokenId}&limit=${limit}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTHENTICATED (requires API key + signed headers)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch orders for the authenticated account.
 * @param {Object} creds  - { apiKey, apiSecret, apiPassphrase }
 * @param {string} status - 'open' | 'closed' | 'cancelled'
 */
export async function getMyOrders(creds, status = 'open') {
  const path    = `/orders?status=${status}`;
  const headers = await buildRestAuthHeaders('GET', path, '', creds);
  return clobFetch(path, { headers });
}

/**
 * Fetch positions for the authenticated account.
 * @param {Object} creds
 */
export async function getMyPositions(creds) {
  const path    = '/positions';
  const headers = await buildRestAuthHeaders('GET', path, '', creds);
  return clobFetch(path, { headers });
}

/**
 * Place a signed limit order on the CLOB.
 *
 * @param {Object} orderParams  - forwarded to buildAndSignOrder()
 *   { maker, tokenId, side, price, sizeUsdc, expirationSecs, nonce, feeRateBps }
 * @param {Object} signerWallet - ethers.Wallet instance
 * @param {Object} creds        - { apiKey, apiSecret, apiPassphrase }
 * @param {string} orderType    - 'GTC' | 'GTD' | 'FOK'
 */
export async function placeLimitOrder(orderParams, signerWallet, creds, orderType = 'GTC') {
  // 1. Build + EIP-712 sign the order locally
  const signedOrder = await buildAndSignOrder(orderParams, signerWallet);

  // 2. Construct the CLOB POST body
  const body = JSON.stringify({
    order:      signedOrder,
    owner:      orderParams.maker,
    orderType,
  });

  // 3. Build signed REST auth headers
  const path    = '/order';
  const headers = await buildRestAuthHeaders('POST', path, body, creds);

  // 4. Broadcast to Polymarket CLOB
  return clobFetch(path, { method: 'POST', headers, body });
}

/**
 * Cancel an open order by order ID.
 *
 * @param {string} orderId
 * @param {Object} creds
 */
export async function cancelOrder(orderId, creds) {
  const path    = `/order/${orderId}`;
  const headers = await buildRestAuthHeaders('DELETE', path, '', creds);
  return clobFetch(path, { method: 'DELETE', headers });
}

/**
 * Cancel all open orders for the authenticated account.
 * @param {Object} creds
 */
export async function cancelAllOrders(creds) {
  const path    = '/orders';
  const headers = await buildRestAuthHeaders('DELETE', path, '', creds);
  return clobFetch(path, { method: 'DELETE', headers });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTION TEST
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Test API credentials by fetching account info.
 * Returns { ok: true, address } or throws with a meaningful error.
 * @param {Object} creds
 */
export async function testConnection(creds) {
  const path    = '/auth/api-key';
  const headers = await buildRestAuthHeaders('GET', path, '', creds);
  const data    = await clobFetch(path, { headers });
  return { ok: true, address: data.address || creds.walletAddress, data };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVENIENCE: compute taker fee for a given trade
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute Polymarket taker fee in USDC for a crypto market order.
 * formula: feeRate × shares × price × (1 − price)
 * Crypto feeRate = 0.072 (7.2%)
 *
 * @param {number} shares      - number of shares
 * @param {number} price       - share price (0–1)
 * @param {number} feeRate     - default 0.072 (crypto)
 */
export function computeTakerFee(shares, price, feeRate = 0.072) {
  return feeRate * shares * price * (1 - price);
}

/**
 * Compute net P&L after Polymarket taker fees (paper or live).
 *
 * @param {'win'|'loss'} outcome
 * @param {number} sizeUsdc     - position size in USDC
 * @param {number} entryPrice   - e.g. 0.55
 * @param {number} feeRate      - default 0.072
 */
export function computeNetPnl(outcome, sizeUsdc, entryPrice, feeRate = 0.072) {
  const shares  = sizeUsdc / entryPrice;
  const feeDrag = computeTakerFee(shares, entryPrice, feeRate);
  const gross   = outcome === 'win'
    ? sizeUsdc * ((1 - entryPrice) / entryPrice)
    : -sizeUsdc;
  return gross - feeDrag;
}