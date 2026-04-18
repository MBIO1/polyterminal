/**
 * Auto-Signer for Live Trading
 *
 * Runs server-side. Uses ethers.js to sign EIP-712 orders and broadcasts to Polymarket CLOB.
 * Private key never touches the browser.
 *
 * SECURITY:
 * - All orders require admin role
 * - Size capped at $50 per order
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

function buildOrderStruct(tokenId, side, price, sizeUsdc, makerAddress, userEmail) {
  if (!tokenId || typeof tokenId !== 'string') throw new Error('Invalid tokenId');
  if (side !== 0 && side !== 1) throw new Error('Invalid side (0=BUY, 1=SELL)');
  if (price <= 0 || price >= 1) throw new Error('Price must be between 0 and 1');
  if (sizeUsdc <= 0 || sizeUsdc > 50) throw new Error('Size must be 0 < size <= $50');
  
  const now = Math.floor(Date.now() / 1000);
  const makerAmount = ethers.parseUnits(sizeUsdc.toString(), 6);
  const takerAmount = ethers.parseUnits((sizeUsdc / price).toString(), 6);
  
  return {
    salt: ethers.toBigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
    maker: makerAddress,
    signer: makerAddress,
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

async function broadcastToCLOB(order, signature, apiKey, apiSecret, passphrase) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const method = 'POST';
  const path = '/order';
  
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
  
  const bodyStr = JSON.stringify(orderPayload);
  const signatureBody = timestamp + method + path + bodyStr;
  
  const encoder = new TextEncoder();
  const keyBuffer = encoder.encode(apiSecret);
  const dataBuffer = encoder.encode(signatureBody);
  const hashBuffer = await crypto.subtle.sign('HMAC', 
    await crypto.subtle.importKey('raw', keyBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    dataBuffer
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hmacSig = btoa(String.fromCharCode(...hashArray));
  
  const res = await fetch('https://clob.polymarket.com/order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'POLY-SIGNATURE': hmacSig,
      'POLY-API-KEY': apiKey,
      'POLY-API-PASSPHRASE': passphrase,
      'POLY-NONCE': timestamp,
    },
    body: bodyStr,
    signal: AbortSignal.timeout(15000),
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`CLOB ${res.status}: ${errorText}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }
    
    const body = await req.json();
    const { tokenId, side, price, sizeUsdc } = body;
    
    const makerAddress = Deno.env.get('POLY_WALLET_ADDRESS');
    const privateKey = Deno.env.get('POLY_PRIVATE_KEY');
    const apiKey = Deno.env.get('POLY_API_KEY');
    const apiSecret = Deno.env.get('POLY_API_SECRET');
    const passphrase = Deno.env.get('POLY_API_PASSPHRASE');
    
    if (!makerAddress || !privateKey || !apiKey || !apiSecret || !passphrase) {
      return Response.json({ 
        error: 'Missing credentials',
        status: 'credential_error'
      }, { status: 500 });
    }
    
    if (!tokenId || side !== 0 && side !== 1 || !price || price <= 0 || price >= 1 || !sizeUsdc || sizeUsdc <= 0) {
      return Response.json({ error: 'Invalid order parameters', status: 'validation_error' }, { status: 400 });
    }
    
    const orderStruct = buildOrderStruct(tokenId, side, price, sizeUsdc, makerAddress, user.email);
    const wallet = new ethers.Wallet(privateKey);
    const signature = await wallet.signTypedData(EIP712_DOMAIN, ORDER_TYPES, orderStruct);
    
    const clobRes = await broadcastToCLOB(orderStruct, signature, apiKey, apiSecret, passphrase);
    
    await base44.asServiceRole.entities.BotTrade.create({
      market_title: `Live order ${tokenId.slice(0, 10)}…`,
      asset: 'BTC',
      contract_type: '5min_up',
      side: side === 0 ? 'yes' : 'no',
      entry_price: price,
      size_usdc: sizeUsdc,
      shares: Math.round(sizeUsdc / price),
      outcome: 'pending',
      mode: 'live',
      notes: `✅ Auto-signed · ${user.email}`,
    });
    
    return Response.json({
      success: true,
      orderId: clobRes.order_id || 'pending',
      signature: signature.slice(0, 20) + '…',
      size: sizeUsdc,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error.message || '';
    if (msg.includes('401') || msg.includes('unauthorized')) {
      return Response.json({ 
        success: false, 
        error: 'CLOB 401: API credentials invalid or account not approved for API trading.',
        status: 'auth_error',
      }, { status: 401 });
    }
    return Response.json({ 
      success: false, 
      error: error.message,
      status: 'execution_error',
    }, { status: 500 });
  }
});