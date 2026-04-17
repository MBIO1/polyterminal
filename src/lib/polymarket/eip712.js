/**
 * EIP-712 Order Signing for Polymarket CLOB
 *
 * Polymarket uses the CTF Exchange contract on Polygon.
 * Orders are structured as EIP-712 typed data and signed with the user's
 * private key. The resulting signature is appended to the order before
 * broadcast — Polymarket's matching engine verifies it on-chain.
 *
 * References:
 *   - EIP-712: https://eips.ethereum.org/EIPS/eip-712
 *   - Polymarket CTF Exchange: https://docs.polymarket.com/trading/orderbook
 *   - Contract: 0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E (Polygon mainnet)
 */

// ── Polymarket CTF Exchange domain (Polygon mainnet) ─────────────────────────
const DOMAIN = {
  name: 'Polymarket CTF Exchange',
  version: '1',
  chainId: 137, // Polygon mainnet
  verifyingContract: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
};

// ── EIP-712 Order Type ────────────────────────────────────────────────────────
const ORDER_TYPES = {
  Order: [
    { name: 'salt',          type: 'uint256' },
    { name: 'maker',         type: 'address' },
    { name: 'signer',        type: 'address' },
    { name: 'taker',         type: 'address' },
    { name: 'tokenId',       type: 'uint256' },
    { name: 'makerAmount',   type: 'uint256' },
    { name: 'takerAmount',   type: 'uint256' },
    { name: 'expiration',    type: 'uint256' },
    { name: 'nonce',         type: 'uint256' },
    { name: 'feeRateBps',    type: 'uint256' },
    { name: 'side',          type: 'uint8'   },
    { name: 'signatureType', type: 'uint8'   },
  ],
};

// ── Side enum ─────────────────────────────────────────────────────────────────
export const SIDE = { BUY: 0, SELL: 1 };

// ── Signature type ────────────────────────────────────────────────────────────
// 0 = EOA (regular private key wallet)
// 1 = POLY_PROXY
// 2 = POLY_GNOSIS_SAFE
export const SIG_TYPE = { EOA: 0, POLY_PROXY: 1, POLY_GNOSIS_SAFE: 2 };

/**
 * Encode the EIP-712 type hash for the Order struct.
 * Used to build the digest that gets signed.
 */
function encodeTypeHash() {
  const typeString =
    'Order(uint256 salt,address maker,address signer,address taker,uint256 tokenId,' +
    'uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,' +
    'uint256 feeRateBps,uint8 side,uint8 signatureType)';
  return typeString;
}

/**
 * Build the raw order struct for a limit order.
 *
 * @param {Object} params
 * @param {string} params.maker          - Wallet address (0x...)
 * @param {string} params.tokenId        - Polymarket YES/NO token ID (uint256 string)
 * @param {number} params.side           - SIDE.BUY or SIDE.SELL
 * @param {number} params.price          - Price per share (0–1, e.g. 0.55)
 * @param {number} params.sizeUsdc       - Total position size in USDC
 * @param {number} params.expirationSecs - Order TTL in seconds from now (0 = GTC)
 * @param {number} params.nonce          - Incrementing nonce (use Date.now() for simplicity)
 * @param {number} params.feeRateBps     - Taker fee rate in bps (720 for crypto = 7.2%)
 */
export function buildOrderStruct({
  maker,
  tokenId,
  side,
  price,
  sizeUsdc,
  expirationSecs = 0,
  nonce = 0,
  feeRateBps = 720, // 7.2% crypto taker fee
}) {
  // Polymarket uses integer math: amounts in USDC micro-units (6 decimals)
  const USDC_DECIMALS = 1e6;
  const price_clamped = Math.max(0.01, Math.min(0.99, price));

  // makerAmount = what the maker puts in
  // takerAmount = what the maker expects to receive
  // For a BUY at price p with $X: makerAmount=$X in USDC, takerAmount=shares (=$X/p)
  const makerAmount = Math.round(sizeUsdc * USDC_DECIMALS);
  const takerAmount = side === SIDE.BUY
    ? Math.round((sizeUsdc / price_clamped) * USDC_DECIMALS)
    : Math.round(sizeUsdc * price_clamped * USDC_DECIMALS);

  const expiration = expirationSecs > 0
    ? Math.floor(Date.now() / 1000) + expirationSecs
    : 0; // 0 = GTC (good till cancelled)

  const salt = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)).toString();

  return {
    salt,
    maker,
    signer: maker,   // for EOA, signer === maker
    taker: '0x0000000000000000000000000000000000000000', // 0 = open order
    tokenId: tokenId.toString(),
    makerAmount: makerAmount.toString(),
    takerAmount: takerAmount.toString(),
    expiration: expiration.toString(),
    nonce: nonce.toString(),
    feeRateBps: feeRateBps.toString(),
    side: side,
    signatureType: SIG_TYPE.EOA,
  };
}

/**
 * Compute the EIP-712 digest for an order struct.
 * Returns the hex-encoded 32-byte digest ready to be signed with eth_sign.
 *
 * NOTE: In a real implementation this is handled by ethers.js v6 or viem:
 *   import { TypedDataEncoder } from 'ethers';
 *   const hash = TypedDataEncoder.hash(DOMAIN, ORDER_TYPES, orderStruct);
 *
 * We provide the domain + types so the caller can use their preferred library.
 */
export function getEIP712Domain() {
  return DOMAIN;
}

export function getOrderTypes() {
  return ORDER_TYPES;
}

/**
 * Sign an order using ethers.js (v6) — browser-compatible.
 * ethers is NOT included in Base44's package list so this module returns
 * the structured payload ready for signing; the TradingEnginePage imports
 * ethers dynamically from a CDN or the user installs it.
 *
 * Returns the complete signed order payload ready for CLOB submission.
 *
 * @param {Object} orderStruct   - from buildOrderStruct()
 * @param {Object} signerWallet  - ethers.Wallet instance (has signTypedData)
 */
export async function signOrder(orderStruct, signerWallet) {
  // ethers v6: wallet.signTypedData(domain, types, value)
  const signature = await signerWallet.signTypedData(DOMAIN, ORDER_TYPES, orderStruct);
  return {
    ...orderStruct,
    signature,
  };
}

/**
 * Convenience: create, sign, and return the full signed order in one call.
 */
export async function buildAndSignOrder(params, signerWallet) {
  const struct = buildOrderStruct(params);
  return signOrder(struct, signerWallet);
}

// ── REST request signing (HMAC-SHA256 for Polymarket API auth header) ─────────
/**
 * Build the L1 auth header for Polymarket CLOB REST API calls.
 * Header: POLY-SIGNATURE, POLY-TIMESTAMP, POLY-API-KEY, POLY-PASSPHRASE
 *
 * @param {string} method     - HTTP method (GET, POST, DELETE)
 * @param {string} requestPath - e.g. "/orders"
 * @param {string} body        - JSON body string (for POST)
 * @param {Object} creds       - { apiKey, apiSecret, apiPassphrase }
 */
export async function buildRestAuthHeaders(method, requestPath, body = '', creds) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = timestamp + method.toUpperCase() + requestPath + body;

  // HMAC-SHA256 using Web Crypto (browser native, no dependencies)
  const keyData = new TextEncoder().encode(creds.apiSecret);
  const msgData = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const sigArray = Array.from(new Uint8Array(sigBuffer));
  const signature = btoa(String.fromCharCode(...sigArray));

  return {
    'POLY-API-KEY':    creds.apiKey,
    'POLY-SIGNATURE':  signature,
    'POLY-TIMESTAMP':  timestamp,
    'POLY-PASSPHRASE': creds.apiPassphrase,
    'Content-Type':    'application/json',
  };
}