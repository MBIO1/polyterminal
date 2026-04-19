/**
 * live-test-order.js
 * 
 * Fires a single live test order to Polymarket CLOB directly from your machine.
 * Your residential IP bypasses geoblocking — no proxy needed.
 * 
 * Usage:
 *   1. cd local-executor
 *   2. npm install ethers dotenv
 *   3. Copy your .env file here (or set env vars inline below)
 *   4. node live-test-order.js
 * 
 * Required .env vars:
 *   POLY_WALLET_ADDRESS=0x...
 *   POLY_PRIVATE_KEY=0x...
 *   POLY_API_KEY=...
 *   POLY_API_SECRET=...
 *   POLY_API_PASSPHRASE=...
 */

import { ethers } from 'ethers';
import crypto from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

// ── Config ────────────────────────────────────────────────────────────────────
const WALLET_ADDRESS = process.env.POLY_WALLET_ADDRESS;
const PRIVATE_KEY    = process.env.POLY_PRIVATE_KEY;
const API_KEY        = process.env.POLY_API_KEY;
const API_SECRET     = process.env.POLY_API_SECRET;
const PASSPHRASE     = process.env.POLY_API_PASSPHRASE;
const CLOB_BASE      = 'https://clob.polymarket.com';

// ── Test order params (BTC 5min UP, $1 USDC, minimum size) ───────────────────
// Token ID for "Will BTC be higher in 5 min?" YES side
const TOKEN_ID  = '21742633143463906290569050155826241533067272736897614950488156847949938836455';
const SIDE      = 0;       // 0 = BUY
const PRICE     = 0.5;     // 50 cents (mid-market, adjust as needed)
const SIZE_USDC = 1.0;     // $1 USDC — minimum test size

// ── EIP-712 domain ────────────────────────────────────────────────────────────
const EIP712_DOMAIN = {
  name: 'ClobAuthDomain',
  version: '1',
  chainId: 137,
};

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

function buildOrderStruct(tokenId, side, price, sizeUsdc, makerAddress) {
  const makerAmount = ethers.parseUnits(sizeUsdc.toFixed(6), 6);
  const takerAmount = ethers.parseUnits((sizeUsdc / price).toFixed(6), 6);
  const now = Math.floor(Date.now() / 1000);

  return {
    salt:          BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
    maker:         makerAddress,
    signer:        makerAddress,
    taker:         '0x0000000000000000000000000000000000000000',
    tokenId:       BigInt(tokenId),
    makerAmount,
    takerAmount,
    expiration:    BigInt(now + 300),
    nonce:         BigInt(Date.now()),
    feeRateBps:    720n,
    side,
    signatureType: 1,
  };
}

async function hmacSign(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('base64');
}

async function broadcastOrder(orderStruct, signature) {
  const payload = {
    salt:          orderStruct.salt.toString(),
    maker:         orderStruct.maker,
    signer:        orderStruct.signer,
    taker:         orderStruct.taker,
    tokenId:       orderStruct.tokenId.toString(),
    makerAmount:   orderStruct.makerAmount.toString(),
    takerAmount:   orderStruct.takerAmount.toString(),
    expiration:    orderStruct.expiration.toString(),
    nonce:         orderStruct.nonce.toString(),
    feeRateBps:    720,
    side:          orderStruct.side,
    signatureType: orderStruct.signatureType,
    signature,
  };

  const bodyStr   = JSON.stringify(payload);
  const timestamp = Date.now().toString();
  const sigInput  = timestamp + 'POST' + '/order' + bodyStr;
  const hmac      = await hmacSign(API_SECRET, sigInput);

  const headers = {
    'Content-Type':         'application/json',
    'POLY-SIGNATURE':       hmac,
    'POLY-API-KEY':         API_KEY,
    'POLY-API-PASSPHRASE':  PASSPHRASE,
    'POLY-NONCE':           timestamp,
  };

  console.log('\n📤 Sending order to CLOB...');
  const res = await fetch(`${CLOB_BASE}/order`, {
    method:  'POST',
    headers,
    body:    bodyStr,
  });

  const text = await res.text();
  console.log(`\n📥 Response [${res.status}]:`, text);
  return { status: res.status, body: text };
}

async function checkBalance() {
  const POLYGON_RPC  = 'https://polygon-bor-rpc.publicnode.com';
  const USDC_NATIVE  = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
  const selector     = '70a08231';
  const padded       = WALLET_ADDRESS.replace('0x', '').toLowerCase().padStart(64, '0');
  const data         = '0x' + selector + padded;

  const res = await fetch(POLYGON_RPC, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: USDC_NATIVE, data }, 'latest'], id: 1 }),
  });
  const json = await res.json();
  const hex  = json?.result || '0x0';
  return Number(BigInt(hex === '0x' ? '0x0' : hex)) / 1_000_000;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Polymarket Live Test Order\n');

  // Validate env
  const missing = ['POLY_WALLET_ADDRESS','POLY_PRIVATE_KEY','POLY_API_KEY','POLY_API_SECRET','POLY_API_PASSPHRASE']
    .filter(k => !process.env[k]);
  if (missing.length) {
    console.error('❌ Missing env vars:', missing.join(', '));
    process.exit(1);
  }

  // Check balance
  try {
    const bal = await checkBalance();
    console.log(`💰 Wallet USDC balance: $${bal.toFixed(2)}`);
    if (bal < SIZE_USDC) {
      console.error(`❌ Insufficient balance ($${bal.toFixed(2)}) for $${SIZE_USDC} order`);
      process.exit(1);
    }
  } catch (e) {
    console.warn('⚠️  Could not check balance:', e.message);
  }

  // Build + sign order
  const wallet = new ethers.Wallet(PRIVATE_KEY);
  console.log(`👛 Wallet: ${wallet.address}`);
  console.log(`📋 Order: BTC 5min UP | side=BUY | price=${PRICE} | size=$${SIZE_USDC}`);

  const orderStruct = buildOrderStruct(TOKEN_ID, SIDE, PRICE, SIZE_USDC, WALLET_ADDRESS);
  console.log('\n✍️  Signing EIP-712 order...');
  const signature = await wallet.signTypedData(EIP712_DOMAIN, ORDER_TYPES, orderStruct);
  console.log(`✅ Signature: ${signature.slice(0, 20)}…`);

  // Broadcast
  const result = await broadcastOrder(orderStruct, signature);

  if (result.status >= 200 && result.status < 300) {
    console.log('\n🎉 ORDER PLACED SUCCESSFULLY!');
  } else if (result.status === 401) {
    console.log('\n❌ AUTH FAILED — Check API key / secret / passphrase');
  } else if (result.status === 403) {
    console.log('\n❌ GEOBLOCKED — Run from a non-US IP or VPN');
  } else {
    console.log('\n⚠️  Unexpected response — see above');
  }
}

main().catch(console.error);