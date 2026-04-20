#!/usr/bin/env node
/**
 * Local Polymarket CLOB Trade Executor
 *
 * Runs on the DigitalOcean droplet (IP allowlisted with Polymarket).
 * Signs EIP-712 orders locally and broadcasts DIRECTLY to clob.polymarket.com.
 * No proxy required — the droplet's residential-grade IP is not geoblocked.
 *
 * On success, logs the trade to Base44's BotTrade entity via the SDK.
 *
 * Usage:
 *   node trade-executor.js --tokenId=<id> --side=<0|1> --price=<0.01-0.99> --size=<usdc>
 *
 * Required env vars:
 *   POLY_PRIVATE_KEY       — wallet private key (0x...)
 *   POLY_WALLET_ADDRESS    — wallet address matching the key
 *   BASE44_API_KEY         — (optional) to log trade back to Base44 BotTrade
 *   BASE44_APP_ID          — (optional) Base44 app id
 */

import { ethers } from 'ethers';
import crypto from 'node:crypto';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { ProxyAgent } from 'undici';

// ── Bright Data residential proxy (Polymarket geoblocks datacenter IPs) ───────
const proxyHost = process.env.BRIGHT_DATA_SUPERPROXY_HOST;
const proxyPort = process.env.BRIGHT_DATA_SUPERPROXY_PORT;
const proxyUser = process.env.BRIGHT_DATA_SUPERPROXY_USER;
const proxyPass = process.env.BRIGHT_DATA_SUPERPROXY_PASS;
const proxyDispatcher = (proxyHost && proxyPort && proxyUser && proxyPass)
  ? new ProxyAgent({ uri: `http://${proxyHost}:${proxyPort}`, token: `Basic ${Buffer.from(`${proxyUser}:${proxyPass}`).toString('base64')}` })
  : null;
if (proxyDispatcher) {
  console.log(`🌐 Routing via Bright Data residential proxy (${proxyHost}:${proxyPort})`);
} else {
  console.log('⚠️  No Bright Data proxy configured — direct connection (likely geoblocked)');
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);

const tokenId  = args.tokenId;
const side     = parseInt(args.side);
const price    = parseFloat(args.price);
const sizeUsdc = parseFloat(args.size);

if (!tokenId || (side !== 0 && side !== 1) || !(price > 0 && price < 1) || !(sizeUsdc > 0)) {
  console.error('Usage: node trade-executor.js --tokenId=<id> --side=<0|1> --price=<0.01-0.99> --size=<usdc>');
  process.exit(1);
}

const privateKey    = process.env.POLY_PRIVATE_KEY;
const walletAddress = process.env.POLY_WALLET_ADDRESS;

if (!privateKey || !walletAddress) {
  console.error('Missing POLY_PRIVATE_KEY or POLY_WALLET_ADDRESS env vars');
  process.exit(1);
}

// ── EIP-712 domains & types ───────────────────────────────────────────────────
const EIP712_DOMAIN = { name: 'ClobAuthDomain', version: '1', chainId: 137 };
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

const L1_AUTH_DOMAIN = { name: 'ClobAuthDomain', version: '1', chainId: 137 };
const L1_AUTH_TYPES = {
  ClobAuth: [
    { name: 'address',   type: 'address' },
    { name: 'timestamp', type: 'string'  },
    { name: 'nonce',     type: 'uint256' },
    { name: 'message',   type: 'string'  },
  ],
};

// ── Derive fresh L2 API credentials ───────────────────────────────────────────
async function deriveApiCreds(wallet) {
  const ts = `${Math.floor(Date.now() / 1000)}`;
  const value = {
    address:   wallet.address,
    timestamp: ts,
    nonce:     0,
    message:   'This message attests that I control the given wallet',
  };
  const sig = await wallet.signTypedData(L1_AUTH_DOMAIN, L1_AUTH_TYPES, value);
  const res = await fetch('https://clob.polymarket.com/auth/derive-api-key', {
    method: 'GET',
    headers: {
      'content-type':   'application/json',
      'poly_address':   wallet.address,
      'poly_signature': sig,
      'poly_timestamp': ts,
      'poly_nonce':     '0',
    },
    ...(proxyDispatcher && { dispatcher: proxyDispatcher }),
  });
  if (!res.ok) throw new Error(`derive-api-key ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { apiKey: data.apiKey, apiSecret: data.secret, passphrase: data.passphrase };
}

// ── Build EIP-712 order struct ────────────────────────────────────────────────
function buildOrderStruct(tokenId, side, price, sizeUsdc, proxyAddress, signerAddress) {
  const makerAmount = ethers.parseUnits(sizeUsdc.toFixed(6), 6);
  const takerAmount = ethers.parseUnits((sizeUsdc / price).toFixed(6), 6);
  const now = Math.floor(Date.now() / 1000);
  return {
    salt:          ethers.toBigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
    maker:         proxyAddress,   // Polymarket proxy (holds USDC)
    signer:        signerAddress,  // EOA that signs (derived from private key)
    taker:         '0x0000000000000000000000000000000000000000',
    tokenId:       ethers.toBigInt(tokenId),
    makerAmount,
    takerAmount,
    expiration:    ethers.toBigInt(now + 300),
    nonce:         ethers.toBigInt(Date.now()),
    feeRateBps:    720,
    side,
    signatureType: 2,  // 2 = Polymarket proxy wallet
  };
}

// ── base64url helpers ─────────────────────────────────────────────────────────
function base64UrlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, 'base64');
}
function base64UrlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Broadcast directly to CLOB (droplet's IP — no proxy) ──────────────────────
async function broadcastToCLOB(order, signature, apiKey, apiSecret, passphrase, makerAddress) {
  const orderPayload = {
    salt:          order.salt.toString(),
    maker:         order.maker,
    signer:        order.signer,
    taker:         order.taker,
    tokenId:       order.tokenId.toString(),
    makerAmount:   order.makerAmount.toString(),
    takerAmount:   order.takerAmount.toString(),
    expiration:    order.expiration.toString(),
    nonce:         order.nonce.toString(),
    feeRateBps:    720,
    side:          order.side,
    signatureType: order.signatureType,
    signature,
  };

  const bodyStr   = JSON.stringify(orderPayload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyForSig = bodyStr.replace(/'/g, '"');
  const signatureBody = timestamp + 'POST' + '/order' + bodyForSig;

  const keyBytes = base64UrlDecode(apiSecret);
  const hmac = crypto.createHmac('sha256', keyBytes).update(signatureBody).digest();
  const hmacSig = base64UrlEncode(hmac);

  const reqHeaders = {
    'Content-Type':    'application/json',
    'poly_address':    makerAddress,
    'poly_signature':  hmacSig,
    'poly_timestamp':  timestamp,
    'poly_api_key':    apiKey,
    'poly_passphrase': passphrase,
  };

  console.log(proxyDispatcher ? '[CLOB] POST /order (via Bright Data proxy)' : '[CLOB] POST /order (direct)');
  const res = await fetch('https://clob.polymarket.com/order', {
    method:  'POST',
    headers: reqHeaders,
    body:    bodyStr,
    ...(proxyDispatcher && { dispatcher: proxyDispatcher }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`CLOB ${res.status}: ${txt}`);
  }
  return res.json();
}

// ── Optional: log trade back to Base44 ────────────────────────────────────────
async function logTradeToBase44(trade) {
  const apiKey = process.env.BASE44_API_KEY;
  const appId  = process.env.BASE44_APP_ID;
  if (!apiKey || !appId) {
    console.log('[BASE44] Skipping log — no BASE44_API_KEY/BASE44_APP_ID set');
    return;
  }
  try {
    const res = await fetch(`https://app.base44.com/api/apps/${appId}/entities/BotTrade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api_key': apiKey },
      body: JSON.stringify(trade),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    console.log('[BASE44] Trade logged');
  } catch (err) {
    console.log(`[BASE44] Log failed: ${err.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Polymarket CLOB Trade Executor (Droplet Direct — No Proxy)  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log(`🚀 Order: tokenId=${tokenId.slice(0, 12)}… side=${side === 0 ? 'BUY' : 'SELL'} price=${price} size=$${sizeUsdc}\n`);

  const wallet = new ethers.Wallet(privateKey);
  const signerAddress = wallet.address;       // EOA (signs)
  const proxyAddress  = walletAddress;        // Polymarket proxy (holds USDC, receives orders)
  console.log(`   signer (EOA):  ${signerAddress}`);
  console.log(`   maker (proxy): ${proxyAddress}\n`);

  console.log('🔑 Deriving fresh API credentials…');
  const { apiKey, apiSecret, passphrase } = await deriveApiCreds(wallet);
  console.log(`   apiKey=${apiKey}\n`);

  console.log('📋 Building & signing EIP-712 order (signatureType=2, proxy wallet)…');
  const orderStruct = buildOrderStruct(tokenId, side, price, sizeUsdc, proxyAddress, signerAddress);
  const eip712Sig   = await wallet.signTypedData(EIP712_DOMAIN, ORDER_TYPES, orderStruct);
  console.log(`   signature=${eip712Sig.slice(0, 24)}…\n`);

  console.log('📡 Broadcasting to CLOB…');
  // REST auth uses the EOA (signer) address — derived API creds are keyed to it
  const clobRes = await broadcastToCLOB(orderStruct, eip712Sig, apiKey, apiSecret, passphrase, signerAddress);

  console.log('\n✅ Order accepted!');
  console.log(`   orderId=${clobRes.order_id || clobRes.id || 'pending'}`);
  console.log(`   full response:`, clobRes);

  await logTradeToBase44({
    market_title:  `Live order ${tokenId.slice(0, 10)}…`,
    asset:         'BTC',
    contract_type: '5min_up',
    side:          side === 0 ? 'yes' : 'no',
    entry_price:   price,
    size_usdc:     sizeUsdc,
    shares:        Math.round(sizeUsdc / price),
    outcome:       'pending',
    mode:          'live',
    notes:         `✅ Droplet direct · orderId=${clobRes.order_id || clobRes.id} · sig=${eip712Sig.slice(0, 20)}…`,
  });

  console.log('\n🎉 Trade execution complete!');
})().catch(err => {
  console.error('\n❌ Execution failed:', err.message);
  process.exit(1);
});