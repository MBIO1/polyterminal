/**
 * Auto-Signer for Live Trading
 *
 * Runs server-side. Takes order struct, signs with EIP-712 using POLY_PRIVATE_KEY via ethers.js,
 * and broadcasts to Polymarket CLOB. Private key never touches the browser.
 *
 * SECURITY:
 * - All orders require admin role
 * - Size capped at $50 per order
 * - Nonce tracked per user to prevent replay
 * - Credentials pre-checked before signing
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { ethers } from 'npm:ethers@6.13.0';

const EIP712_DOMAIN = {
  name: 'ClobAuthDomain',
  version: '1',
  chainId: 137,
};

const ORDER_TYPES = {
  Order: [
    { name: 'salt',            type: 'uint256' },
    { name: 'maker',           type: 'address' },
    { name: 'signer',          type: 'address' },
    { name: 'taker',           type: 'address' },
    { name: 'tokenId',         type: 'uint256' },
    { name: 'makerAmount',     type: 'uint256' },
    { name: 'takerAmount',     type: 'uint256' },
    { name: 'expiration',      type: 'uint256' },
    { name: 'nonce',           type: 'uint256' },
    { name: 'feeRateBps',      type: 'uint256' },
    { name: 'side',            type: 'uint8'   },
    { name: 'signatureType',   type: 'uint8'   },
  ],
};

// Track nonces per user to prevent replay
const userNonces = {};

// Build order struct for Polymarket CLOB with validation (all strings for JSON safety)
function buildOrderStruct(tokenId, side, price, sizeUsdc, makerAddress, userEmail) {
  // Validation
  if (!tokenId || typeof tokenId !== 'string') throw new Error('Invalid tokenId');
  if (side !== 0 && side !== 1) throw new Error('Invalid side (0=BUY, 1=SELL)');
  if (price <= 0 || price >= 1) throw new Error('Price must be between 0 and 1');
  if (sizeUsdc <= 0 || sizeUsdc > 50) throw new Error('Size must be 0 < size <= $50');
  
  const now = Math.floor(Date.now() / 1000);
  const expirationSeconds = now + 300; // 5 min expiry
  
  // Nonce: increment per user to prevent replay
  if (!userNonces[userEmail]) userNonces[userEmail] = 0;
  const nonce = ++userNonces[userEmail];
  
  // Polymarket CLOB order format (all as strings)
  return {
    salt: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(),
    maker: makerAddress,
    signer: makerAddress,
    taker: '0x0000000000000000000000000000000000000000',
    tokenId: tokenId,
    makerAmount: Math.round(sizeUsdc * 1e6).toString(),
    takerAmount: Math.round((sizeUsdc / price) * 1e6).toString(),
    expiration: expirationSeconds.toString(),
    nonce: nonce.toString(),
    feeRateBps: 720,
    side: side,
    signatureType: 0,
  };
}

// Broadcast to Polymarket CLOB via Oxylabs proxy
async function broadcastToCLOB(order, signature, apiKey, apiSecret, passphrase) {
  const timestamp = Date.now().toString();
  const message = timestamp + 'POST' + '/order';
  
  // HMAC-SHA256 signature for REST auth
  const encoder = new TextEncoder();
  const keyData = encoder.encode(apiSecret);
  const data = encoder.encode(message);
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hmacSig = await crypto.subtle.sign('HMAC', key, data);
  const hmacHex = Array.from(new Uint8Array(hmacSig)).map(b => b.toString(16).padStart(2, '0')).join('');
  
  const oxyUser = Deno.env.get('OXYLABS_USER');
  const oxyPass = Deno.env.get('OXYLABS_PASS');
  const oxyAuth = oxyUser && oxyPass ? btoa(`${oxyUser}:${oxyPass}`) : null;
  
  const orderPayload = {
    salt: order.salt.toString(),
    maker: order.maker,
    signer: order.signer,
    taker: order.taker,
    tokenId: order.tokenId.toString(),
    makerAmount: order.makerAmount.toString(),
    takerAmount: order.takerAmount.toString(),
    expiration: order.expiration.toString(),
    nonce: order.nonce.toString(),
    feeRateBps: 720,
    side: order.side,
    signatureType: order.signatureType,
    signature,
  };
  
  const headers = {
    'Content-Type': 'application/json',
    'POLY-ADDRESS': order.maker,
    'POLY-SIGNATURE': hmacHex,
    'POLY-TIMESTAMP': timestamp,
    'POLY-API-KEY': apiKey,
    'POLY-API-PASSPHRASE': passphrase,
  };
  
  if (oxyAuth) headers['Authorization'] = `Basic ${oxyAuth}`;
  
  const endpoint = oxyAuth
    ? 'https://realtime.oxylabs.io/v1/queries'
    : 'https://clob.polymarket.com/order';
  
  let res;
  if (oxyAuth) {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${oxyAuth}` },
      body: JSON.stringify({
        source: 'universal',
        url: 'https://clob.polymarket.com/order',
        method: 'POST',
        headers,
        body: JSON.stringify(orderPayload),
      }),
      signal: AbortSignal.timeout(15000),
    });
  } else {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(orderPayload),
      signal: AbortSignal.timeout(15000),
    });
  }
  
  if (!res.ok) throw new Error(`CLOB error: ${res.status} ${await res.text()}`);
  return res.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    // ────── SECURITY: Admin-only ──────────────────────────────────────
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }
    
    const body = await req.json();
    const { tokenId, side, price, sizeUsdc } = body;
    
    // ────── PRE-FLIGHT: Check all credentials exist ──────────────────
    const makerAddress = Deno.env.get('POLY_WALLET_ADDRESS');
    const privateKey = Deno.env.get('POLY_PRIVATE_KEY');
    const apiKey = Deno.env.get('POLY_API_KEY');
    const apiSecret = Deno.env.get('POLY_API_SECRET');
    const passphrase = Deno.env.get('POLY_API_PASSPHRASE');
    
    if (!makerAddress || !privateKey || !apiKey || !apiSecret || !passphrase) {
      return Response.json({ 
        error: 'Missing credentials: POLY_WALLET_ADDRESS, POLY_PRIVATE_KEY, POLY_API_KEY, POLY_API_SECRET, POLY_API_PASSPHRASE',
        status: 'credential_error'
      }, { status: 500 });
    }
    
    // ────── VALIDATION: Order params ────────────────────────────────
    try {
      if (!tokenId || typeof tokenId !== 'string') throw new Error('tokenId required');
      if (side !== 0 && side !== 1) throw new Error('side must be 0 (BUY) or 1 (SELL)');
      if (!price || price <= 0 || price >= 1) throw new Error('price must be 0 < price < 1');
      if (!sizeUsdc || sizeUsdc <= 0) throw new Error('sizeUsdc required and > 0');
    } catch (valErr) {
      return Response.json({ error: `Validation: ${valErr.message}`, status: 'validation_error' }, { status: 400 });
    }
    
    // Build order struct (with validation + nonce)
    const orderStruct = buildOrderStruct(tokenId, side, price, sizeUsdc, makerAddress, user.email);
    
    // ────── SIGN: Use ethers.js (proper EIP-712) ────────────────────
    const wallet = new ethers.Wallet(privateKey);
    const signature = await wallet.signTypedData(EIP712_DOMAIN, ORDER_TYPES, orderStruct);
    
    if (!signature || !signature.startsWith('0x')) {
      throw new Error('Signature generation failed');
    }
    
    // ────── BROADCAST: Send to CLOB ────────────────────────────────
    const clobRes = await broadcastToCLOB(orderStruct, signature, apiKey, apiSecret, passphrase);
    
    // ────── LOG: Record to database ────────────────────────────────
    await base44.asServiceRole.entities.BotTrade.create({
      market_title: `Live order ${tokenId.slice(0, 10)}…`,
      asset: tokenId.includes('21742633') ? 'BTC' : 'ETH',
      contract_type: '5min_up',
      side: side === 0 ? 'yes' : 'no',
      entry_price: price,
      size_usdc: sizeUsdc,
      shares: Math.round(sizeUsdc / price),
      edge_at_entry: 0,
      confidence_at_entry: 50,
      kelly_fraction_used: 0.5,
      pnl_usdc: 0,
      outcome: 'pending',
      mode: 'live',
      notes: `✅ Live auto-signed · User: ${user.email} · Nonce: ${orderStruct.nonce} · Sig: ${signature.slice(0, 20)}…`,
    });
    
    return Response.json({
      success: true,
      orderId: clobRes.order_id,
      signature: signature.slice(0, 20) + '…',
      size: sizeUsdc,
      nonce: orderStruct.nonce,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ 
      success: false, 
      error: error.message,
      status: 'execution_error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
});