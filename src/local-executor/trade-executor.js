#!/usr/bin/env node
/**
 * Local Trade Executor for Polymarket CLOB
 * 
 * Runs on your local machine with Bright Data residential proxy.
 * Executes signed trade orders to bypass geoblocking.
 * 
 * Usage:
 *   node trade-executor.js --tokenId=<id> --side=<0|1> --price=<0.xx> --size=<usdc>
 *   
 * Example:
 *   node trade-executor.js --tokenId=21742633... --side=0 --price=0.52 --size=1
 */

const http = require('http');
const https = require('https');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { ethers } = require('ethers');
const crypto = require('crypto');

// ────────────────────────────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────────────────────────────

const BRIGHT_DATA_HOST = process.env.BRIGHT_DATA_SUPERPROXY_HOST || 'brd.superproxy.io';
const BRIGHT_DATA_PORT = process.env.BRIGHT_DATA_SUPERPROXY_PORT || '33335';
const BRIGHT_DATA_USER = process.env.BRIGHT_DATA_SUPERPROXY_USER;
const BRIGHT_DATA_PASS = process.env.BRIGHT_DATA_SUPERPROXY_PASS;

const POLY_WALLET = process.env.POLY_WALLET_ADDRESS;
const POLY_PRIVATE_KEY = process.env.POLY_PRIVATE_KEY;
const POLY_API_KEY = process.env.POLY_API_KEY;
const POLY_API_SECRET = process.env.POLY_API_SECRET;
const POLY_API_PASSPHRASE = process.env.POLY_API_PASSPHRASE;

const EIP712_DOMAIN = {
  name: 'ClobAuthDomain',
  version: '1',
  chainId: 137,
};

const ORDER_TYPES = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'makerAmount', type: 'uint256' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'expiration', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'feeRateBps', type: 'uint256' },
    { name: 'side', type: 'uint8' },
    { name: 'signatureType', type: 'uint8' },
  ],
};

// ────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ────────────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (const arg of args) {
    const [key, value] = arg.split('=');
    result[key.replace('--', '')] = value;
  }
  return result;
}

function validateCreds() {
  const missing = [];
  if (!BRIGHT_DATA_USER) missing.push('BRIGHT_DATA_SUPERPROXY_USER');
  if (!BRIGHT_DATA_PASS) missing.push('BRIGHT_DATA_SUPERPROXY_PASS');
  if (!POLY_WALLET) missing.push('POLY_WALLET_ADDRESS');
  if (!POLY_PRIVATE_KEY) missing.push('POLY_PRIVATE_KEY');
  if (!POLY_API_KEY) missing.push('POLY_API_KEY');
  if (!POLY_API_SECRET) missing.push('POLY_API_SECRET');
  if (!POLY_API_PASSPHRASE) missing.push('POLY_API_PASSPHRASE');
  
  if (missing.length > 0) {
    console.error(`❌ Missing credentials: ${missing.join(', ')}`);
    process.exit(1);
  }
}

function buildOrderStruct(tokenId, side, price, sizeUsdc) {
  const makerAmount = ethers.parseUnits(sizeUsdc.toFixed(6), 6);
  const takerAmount = ethers.parseUnits((sizeUsdc / price).toFixed(6), 6);
  const now = Math.floor(Date.now() / 1000);
  
  return {
    salt: ethers.toBigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
    maker: POLY_WALLET,
    signer: POLY_WALLET,
    taker: '0x0000000000000000000000000000000000000000',
    tokenId: ethers.toBigInt(tokenId),
    makerAmount: makerAmount,
    takerAmount: takerAmount,
    expiration: ethers.toBigInt(now + 300),
    nonce: ethers.toBigInt(Date.now()),
    feeRateBps: 720,
    side: side,
    signatureType: 1,
  };
}

async function signOrder(orderStruct) {
  const wallet = new ethers.Wallet(POLY_PRIVATE_KEY);
  const signature = await wallet.signTypedData(EIP712_DOMAIN, ORDER_TYPES, orderStruct);
  return signature;
}

function serializeOrder(orderStruct) {
  return {
    salt: orderStruct.salt.toString(),
    maker: orderStruct.maker,
    signer: orderStruct.signer,
    taker: orderStruct.taker,
    tokenId: orderStruct.tokenId.toString(),
    makerAmount: orderStruct.makerAmount.toString(),
    takerAmount: orderStruct.takerAmount.toString(),
    expiration: orderStruct.expiration.toString(),
    nonce: orderStruct.nonce.toString(),
    feeRateBps: 720,
    side: orderStruct.side,
    signatureType: orderStruct.signatureType,
  };
}

function computeHmacSignature(bodyStr, timestamp) {
  const method = 'POST';
  const path = '/order';
  const signatureBody = timestamp + method + path + bodyStr;
  
  const hmac = crypto.createHmac('sha256', POLY_API_SECRET);
  hmac.update(signatureBody);
  return hmac.digest('base64');
}

// ────────────────────────────────────────────────────────────────────────────
// EXECUTION
// ────────────────────────────────────────────────────────────────────────────

async function executeOrder(tokenId, side, price, sizeUsdc) {
  console.log(`🚀 Executing order via Bright Data proxy...`);
  console.log(`   Token: ${tokenId.slice(0, 12)}...`);
  console.log(`   Side: ${side === 0 ? 'BUY' : 'SELL'} | Price: ${price} | Size: $${sizeUsdc}`);
  
  // 1. Build order struct
  console.log(`\n📋 Building EIP-712 order struct...`);
  const orderStruct = buildOrderStruct(tokenId, side, price, sizeUsdc);
  
  // 2. Sign order
  console.log(`🔐 Signing with EIP-712...`);
  const signature = await signOrder(orderStruct);
  console.log(`   Signature: ${signature.slice(0, 20)}...${signature.slice(-10)}`);
  
  // 3. Serialize and prepare payload
  const orderPayload = serializeOrder(orderStruct);
  orderPayload.signature = signature;
  const bodyStr = JSON.stringify(orderPayload);
  const timestamp = Date.now().toString();
  
  // 4. Compute HMAC signature
  console.log(`\n🔑 Computing HMAC-SHA256 REST auth...`);
  const hmacSig = computeHmacSignature(bodyStr, timestamp);
  
  // 5. Prepare proxy URL
  const proxyUrl = `http://${BRIGHT_DATA_USER}:${BRIGHT_DATA_PASS}@${BRIGHT_DATA_HOST}:${BRIGHT_DATA_PORT}`;
  const httpsAgent = new HttpsProxyAgent(proxyUrl);
  
  // 6. Make request via Bright Data proxy
  console.log(`\n📡 Broadcasting via Bright Data to CLOB...`);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'clob.polymarket.com',
      port: 443,
      path: '/order',
      method: 'POST',
      agent: httpsAgent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'POLY-SIGNATURE': hmacSig,
        'POLY-API-KEY': POLY_API_KEY,
        'POLY-API-PASSPHRASE': POLY_API_PASSPHRASE,
        'POLY-NONCE': timestamp,
      },
      timeout: 25000,
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          console.log(`\n✅ Order accepted!`);
          try {
            const result = JSON.parse(data);
            console.log(`   Order ID: ${result.order_id || result.id || 'pending'}`);
            resolve(result);
          } catch (e) {
            resolve({ success: true, response: data });
          }
        } else {
          console.error(`\n❌ CLOB returned ${res.statusCode}`);
          console.error(`   Response: ${data}`);
          reject(new Error(`CLOB ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', (err) => {
      console.error(`\n❌ Request error: ${err.message}`);
      reject(err);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.write(bodyStr);
    req.end();
  });
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Polymarket CLOB Trade Executor (Local + Bright Data Proxy)  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  validateCreds();
  
  const args = parseArgs();
  const tokenId = args.tokenId;
  const side = parseInt(args.side);
  const price = parseFloat(args.price);
  const size = parseFloat(args.size);
  
  if (!tokenId || isNaN(side) || isNaN(price) || isNaN(size)) {
    console.error('❌ Missing or invalid arguments');
    console.error('Usage: node trade-executor.js --tokenId=<id> --side=<0|1> --price=<0.xx> --size=<usdc>');
    process.exit(1);
  }
  
  try {
    await executeOrder(tokenId, side, price, size);
    console.log(`\n🎉 Trade execution complete!\n`);
    process.exit(0);
  } catch (err) {
    console.error(`\n💥 Trade failed: ${err.message}\n`);
    process.exit(1);
  }
}

main();