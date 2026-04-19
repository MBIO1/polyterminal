/**
 * Auto-Signer for Live Trading v2
 *
 * Runs server-side. Uses ethers.js to sign EIP-712 orders and broadcasts DIRECTLY to Polymarket CLOB.
 * No proxy — direct fetch only. Private key never touches the browser.
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

// L1 auth types for deriving L2 API creds on demand
const L1_AUTH_DOMAIN = { name: 'ClobAuthDomain', version: '1', chainId: 137 };
const L1_AUTH_TYPES = {
  ClobAuth: [
    { name: 'address',   type: 'address' },
    { name: 'timestamp', type: 'string'  },
    { name: 'nonce',     type: 'uint256' },
    { name: 'message',   type: 'string'  },
  ],
};

/**
 * Derive fresh L2 API credentials from the wallet's private key.
 * Bypasses any stale stored secrets — always returns what Polymarket currently has on file.
 */
async function deriveApiCreds(wallet) {
  const ts = `${Math.floor(Date.now() / 1000)}`;
  const value = {
    address: wallet.address,
    timestamp: ts,
    nonce: 0,
    message: 'This message attests that I control the given wallet',
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
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`derive-api-key ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { apiKey: data.apiKey, apiSecret: data.secret, passphrase: data.passphrase };
}

function buildOrderStruct(tokenId, side, price, sizeUsdc, makerAddress) {
  // Validate all inputs
  if (!tokenId || typeof tokenId !== 'string') throw new Error('Invalid tokenId');
  if (side !== 0 && side !== 1) throw new Error('Invalid side (0=BUY, 1=SELL)');
  const priceNum = parseFloat(price);
  const sizeNum = parseFloat(sizeUsdc);
  if (isNaN(priceNum) || priceNum <= 0 || priceNum >= 1) throw new Error(`Invalid price: ${price}`);
  if (isNaN(sizeNum) || sizeNum <= 0) throw new Error(`Invalid size: ${sizeUsdc}`);
  
  // Convert amounts properly
  const makerAmount = ethers.parseUnits(sizeNum.toFixed(6), 6);
  const takerAmount = ethers.parseUnits((sizeNum / priceNum).toFixed(6), 6);
  const now = Math.floor(Date.now() / 1000);
  
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

async function broadcastToCLOB(order, signature, apiKey, apiSecret, passphrase, makerAddress) {
  if (!apiKey || !apiSecret || !passphrase) {
    throw new Error('Missing REST auth credentials: apiKey, apiSecret, or passphrase');
  }

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
  // Polymarket HMAC spec: timestamp in SECONDS, body with single→double quote swap for parity with Go/TS
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyForSig = bodyStr.replace(/'/g, '"');
  const signatureBody = timestamp + 'POST' + '/order' + bodyForSig;

  // base64url-decode the secret into raw bytes, HMAC-SHA256, then base64url-encode the result
  const base64UrlDecode = (str) => {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    const bin = atob(s + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };
  const base64UrlEncode = (buf) =>
    btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_');

  const keyBytes = base64UrlDecode(apiSecret);
  const hashBuffer = await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    new TextEncoder().encode(signatureBody)
  );
  const hmacSig = base64UrlEncode(hashBuffer);

  // Polymarket uses snake_case lowercase headers (not dashed uppercase)
  const reqHeaders = {
    'Content-Type':    'application/json',
    'poly_address':    makerAddress,
    'poly_signature':  hmacSig,
    'poly_timestamp':  timestamp,
    'poly_api_key':    apiKey,
    'poly_passphrase': passphrase,
  };

  // Try Bright Data residential proxy — pick whichever secret name is set
  // HOST = full "brd-customer-xxx-zone-yyy" username, PORT = password
  const bdUser = Deno.env.get('BRIGHT_DATA_SUPERPROXY_HOST') || Deno.env.get('BRIGHT_DATA_USER') || Deno.env.get('BRIGHT_DATA_SUPERPROXY_USER');
  const bdPass = Deno.env.get('BRIGHT_DATA_SUPERPROXY_PORT') || Deno.env.get('BRIGHT_DATA_PASS') || Deno.env.get('BRIGHT_DATA_SUPERPROXY_PASS');
  console.log(`[PROXY] bdUser="${bdUser}" bdPass_len=${bdPass?.length}`);

  if (bdUser && bdPass) {
    try {
      console.log(`[PROXY] Opening TCP tunnel via brd.superproxy.io:22225`);
      const conn = await Deno.connect({ hostname: 'brd.superproxy.io', port: 22225 });

      const proxyAuth = btoa(`${bdUser}:${bdPass}`);
      const connectReq = `CONNECT clob.polymarket.com:443 HTTP/1.1\r\nHost: clob.polymarket.com:443\r\nProxy-Authorization: Basic ${proxyAuth}\r\n\r\n`;
      await conn.write(new TextEncoder().encode(connectReq));

      // Read CONNECT response
      const buf = new Uint8Array(4096);
      const n = await conn.read(buf);
      const connectResp = new TextDecoder().decode(buf.subarray(0, n));
      console.log(`[PROXY] CONNECT response: ${connectResp.split('\r\n')[0]}`);

      if (!connectResp.includes('200')) {
        conn.close();
        throw new Error(`Proxy CONNECT failed: ${connectResp.split('\r\n')[0]}`);
      }

      // TLS upgrade over the tunnel
      const tlsConn = await Deno.startTls(conn, { hostname: 'clob.polymarket.com' });

      // Send HTTP request over TLS tunnel
      const httpReq = [
        `POST /order HTTP/1.1`,
        `Host: clob.polymarket.com`,
        ...Object.entries(reqHeaders).map(([k, v]) => `${k}: ${v}`),
        `Content-Length: ${new TextEncoder().encode(bodyStr).length}`,
        `Connection: close`,
        ``,
        bodyStr,
      ].join('\r\n');

      await tlsConn.write(new TextEncoder().encode(httpReq));

      // Read response
      const chunks = [];
      const readBuf = new Uint8Array(8192);
      while (true) {
        const nr = await tlsConn.read(readBuf);
        if (nr === null) break;
        chunks.push(readBuf.slice(0, nr));
      }
      tlsConn.close();

      const fullResp = new TextDecoder().decode(
        chunks.reduce((a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }, new Uint8Array())
      );
      const [respHead, ...respBodyParts] = fullResp.split('\r\n\r\n');
      const statusLine = respHead.split('\r\n')[0];
      const statusCode = parseInt(statusLine.split(' ')[1]);
      const respBody = respBodyParts.join('\r\n\r\n').trim();

      console.log(`[PROXY] CLOB response: ${statusLine}`);

      if (statusCode === 401) throw new Error(`CLOB 401 Unauthorized`);
      if (statusCode === 403) throw new Error(`CLOB 403 Geoblocked`);
      if (statusCode < 200 || statusCode >= 300) throw new Error(`CLOB ${statusCode}: ${respBody}`);

      return JSON.parse(respBody);
    } catch (proxyErr) {
      console.log(`[PROXY] Failed: ${proxyErr.message} — falling back to direct`);
      // Fall through to direct fetch below
    }
  }

  // Fallback: direct (will be geoblocked on Deno Deploy cloud IPs)
  const res = await fetch('https://clob.polymarket.com/order', {
    method: 'POST',
    headers: reqHeaders,
    body: bodyStr,
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const errorText = await res.text();
    const status = res.status;
    if (status === 401) throw new Error(`CLOB 401 Unauthorized`);
    if (status === 403) throw new Error(`CLOB 403 Geoblocked`);
    throw new Error(`CLOB ${status}: ${errorText}`);
  }

  return res.json();
}

// Allowlisted IPs that can invoke without admin auth (e.g., DigitalOcean droplet)
const ALLOWED_IPS = new Set(['64.225.16.230']);

function getClientIP(req) {
  // Check forwarded headers (Deno Deploy sets these)
  const fwd = req.headers.get('x-forwarded-for') || '';
  const first = fwd.split(',')[0].trim();
  return first || req.headers.get('x-real-ip') || '';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const clientIP = getClientIP(req);
    const ipAllowed = ALLOWED_IPS.has(clientIP);

    let user = null;
    try { user = await base44.auth.me(); } catch (_) { /* droplet has no user session */ }

    console.log(`[AUTH] user=${user?.email} role=${user?.role} ip=${clientIP} ipAllowed=${ipAllowed}`);

    // Admit if EITHER: admin user OR request from allowlisted droplet IP
    if (!ipAllowed && (!user || user.role !== 'admin')) {
      return Response.json({ error: 'Forbidden: admin or allowlisted IP required' }, { status: 403 });
    }
    
    const body = await req.json();
    const { tokenId, side, price, sizeUsdc } = body;
    
    // Pre-flight: only the wallet credentials are required — API creds are derived live
    const privateKey = Deno.env.get('POLY_PRIVATE_KEY');
    const walletAddressEnv = Deno.env.get('POLY_WALLET_ADDRESS');
    if (!privateKey || !walletAddressEnv) {
      return Response.json({
        success: false,
        error: 'Missing POLY_PRIVATE_KEY or POLY_WALLET_ADDRESS',
        status: 'credential_error',
      }, { status: 500 });
    }
    
    // Validate order params
    if (!tokenId) throw new Error('tokenId is required');
    if (side !== 0 && side !== 1) throw new Error('side must be 0 (BUY) or 1 (SELL)');
    if (!price) throw new Error('price is required');
    if (!sizeUsdc) throw new Error('sizeUsdc is required');
    
    // Build wallet + derive fresh L2 API creds (bypasses any stale stored secrets)
    const wallet = new ethers.Wallet(privateKey);
    const makerAddress = wallet.address;
    console.log(`[AUTH] Deriving fresh API creds for ${makerAddress}`);
    const { apiKey, apiSecret, passphrase } = await deriveApiCreds(wallet);
    console.log(`[AUTH] Got apiKey=${apiKey}`);
    
    // Build and sign order
    console.log(`[SIGN] Building order: tokenId=${tokenId.slice(0,10)} side=${side} price=${price} size=${sizeUsdc}`);
    const orderStruct = buildOrderStruct(tokenId, side, price, sizeUsdc, makerAddress);
    const eip712Sig = await wallet.signTypedData(EIP712_DOMAIN, ORDER_TYPES, orderStruct);
    console.log(`[SIGN] Signed: ${eip712Sig.slice(0,20)}`);
    
    if (!eip712Sig || !eip712Sig.startsWith('0x')) {
      throw new Error('EIP-712 signature generation failed');
    }
    
    // Broadcast directly to CLOB
    const clobRes = await broadcastToCLOB(orderStruct, eip712Sig, apiKey, apiSecret, passphrase, makerAddress);
    
    // Log trade
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
      notes: `✅ Live order · ${user?.email || `droplet:${clientIP}`} · EIP712 sig: ${eip712Sig.slice(0, 20)}…`,
    });

    // Send Telegram notification (fire-and-forget — never block response)
    try {
      const tgToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
      const tgChat  = Deno.env.get('TELEGRAM_CHAT_ID');
      if (tgToken && tgChat) {
        const sideLabel = side === 0 ? 'BUY (YES)' : 'SELL (NO)';
        const orderId = clobRes.order_id || clobRes.id || 'pending';
        const text =
          `✅ *Live Trade Executed*\n\n` +
          `*Side:* ${sideLabel}\n` +
          `*Entry Price:* ${price}\n` +
          `*Size:* $${sizeUsdc} USDC\n` +
          `*Token:* \`${tokenId.slice(0, 12)}…\`\n` +
          `*Order ID:* \`${orderId}\`\n` +
          `*By:* ${user?.email || `droplet:${clientIP}`}\n` +
          `*Time:* ${new Date().toISOString()}`;
        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: tgChat, text, parse_mode: 'Markdown' }),
          signal: AbortSignal.timeout(5000),
        });
        console.log('[TELEGRAM] Notification sent');
      } else {
        console.log('[TELEGRAM] Skipped — missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
      }
    } catch (tgErr) {
      console.log(`[TELEGRAM] Send failed: ${tgErr.message}`);
    }

    return Response.json({
      success: true,
      orderId: clobRes.order_id || clobRes.id || 'pending',
      signature: eip712Sig.slice(0, 20) + '…',
      size: sizeUsdc,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error.message || '';
    
    if (msg.includes('401')) {
      return Response.json({ 
        success: false, 
        error: msg,
        status: 'auth_error',
      }, { status: 401 });
    }
    
    return Response.json({ 
      success: false, 
      error: msg,
      status: 'execution_error',
    }, { status: 500 });
  }
});