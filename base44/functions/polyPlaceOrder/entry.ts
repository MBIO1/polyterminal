/**
 * polyPlaceOrder — Full order placement pipeline (server-side).
 * 1. Builds the EIP-712 order struct
 * 2. Signs it with POLY_PRIVATE_KEY
 * 3. Builds HMAC REST auth headers
 * 4. POSTs to Polymarket CLOB /order
 *
 * Body params:
 *   tokenId      - Polymarket YES/NO token ID string
 *   side         - "BUY" or "SELL"
 *   price        - 0–1 (e.g. 0.52)
 *   sizeUsdc     - USDC amount (e.g. 1)
 *   expirySecs   - TTL in seconds, 0 = GTC (default 300)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { ethers } from 'npm:ethers@6.13.0';

const CLOB_BASE = 'https://clob.polymarket.com';

const DOMAIN = {
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

async function buildHmacHeaders(method, path, body, apiKey, apiSecret, passphrase) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = timestamp + method.toUpperCase() + path + (body || '');
  const keyData = new TextEncoder().encode(apiSecret);
  const msgData = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const sigArray = Array.from(new Uint8Array(sigBuffer));
  const signature = btoa(String.fromCharCode(...sigArray));
  return {
    'POLY-API-KEY': apiKey,
    'POLY-SIGNATURE': signature,
    'POLY-TIMESTAMP': timestamp,
    'POLY-PASSPHRASE': passphrase,
    'Content-Type': 'application/json',
  };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Load credentials
  const privateKey  = Deno.env.get('POLY_PRIVATE_KEY');
  const apiKey      = Deno.env.get('POLY_API_KEY');
  const apiSecret   = Deno.env.get('POLY_API_SECRET');
  const passphrase  = Deno.env.get('POLY_API_PASSPHRASE');
  const walletAddr  = Deno.env.get('POLY_WALLET_ADDRESS');

  if (!privateKey || !apiKey || !apiSecret || !passphrase || !walletAddr) {
    return Response.json({ error: 'Missing credentials in environment' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    tokenId   = '21742633143463906290569050155826241533067272736897614950488156847949938836455',
    side      = 'BUY',
    price     = 0.5,
    sizeUsdc  = 1,
    expirySecs = 300,
  } = body;

  // ── 1. Build order struct ──────────────────────────────────────────────────
  const USDC_DECIMALS = 1e6;
  const sideInt = side === 'BUY' ? 0 : 1;
  const priceClamped = Math.max(0.01, Math.min(0.99, Number(price)));
  const makerAmount = Math.round(Number(sizeUsdc) * USDC_DECIMALS);
  const takerAmount = sideInt === 0
    ? Math.round((Number(sizeUsdc) / priceClamped) * USDC_DECIMALS)
    : Math.round(Number(sizeUsdc) * priceClamped * USDC_DECIMALS);
  const expiration = expirySecs > 0 ? Math.floor(Date.now() / 1000) + Number(expirySecs) : 0;
  const saltNum = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  const salt = saltNum.toString();

  const orderStruct = {
    salt,
    maker:         walletAddr,
    signer:        walletAddr,
    taker:         '0x0000000000000000000000000000000000000000',
    tokenId:       tokenId.toString(),
    makerAmount:   makerAmount.toString(),
    takerAmount:   takerAmount.toString(),
    expiration:    expiration.toString(),
    nonce:         '0',
    feeRateBps:    '720',
    side:          sideInt,
    signatureType: 0,
  };

  // ── 2. Sign with EIP-712 ───────────────────────────────────────────────────
  const wallet = new ethers.Wallet(privateKey);
  const signature = await wallet.signTypedData(DOMAIN, ORDER_TYPES, orderStruct);

  // ── 3. Build the CLOB order payload ───────────────────────────────────────
  const orderPayload = {
    order: {
      salt:          orderStruct.salt,
      maker:         orderStruct.maker,
      signer:        orderStruct.signer,
      taker:         orderStruct.taker,
      tokenId:       orderStruct.tokenId,
      makerAmount:   orderStruct.makerAmount,
      takerAmount:   orderStruct.takerAmount,
      expiration:    orderStruct.expiration,
      nonce:         orderStruct.nonce,
      feeRateBps:    orderStruct.feeRateBps,
      side:          orderStruct.side.toString(),
      signatureType: orderStruct.signatureType.toString(),
      signature,
    },
    owner: walletAddr,
    orderType: 'GTC',
  };

  const bodyStr = JSON.stringify(orderPayload);

  // ── 4. POST to CLOB ────────────────────────────────────────────────────────
  const headers = await buildHmacHeaders('POST', '/order', bodyStr, apiKey, apiSecret, passphrase);

  // Route through Oxylabs Scraper API to bypass geo-block
  const oxyUser = Deno.env.get('OXYLABS_USER');
  const oxyPass = Deno.env.get('OXYLABS_PASS');

  let clobRes;
  if (oxyUser && oxyPass) {
    const oxyAuth = btoa(`${oxyUser}:${oxyPass}`);
    const scraperRes = await fetch('https://realtime.oxylabs.io/v1/queries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${oxyAuth}` },
      body: JSON.stringify({
        source: 'universal',
        url: `${CLOB_BASE}/order`,
        method: 'POST',
        body: bodyStr,
        headers,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!scraperRes.ok) {
      return Response.json({ error: `Oxylabs error: ${scraperRes.status}` }, { status: 502 });
    }
    const data = await scraperRes.json();
    const content = data?.results?.[0]?.content;
    clobRes = new Response(content, { status: 200 });
  } else {
    clobRes = await fetch(`${CLOB_BASE}/order`, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: AbortSignal.timeout(10000),
    });
  }

  let clobData;
  try {
    clobData = await clobRes.json();
  } catch (_) {
    clobData = { raw: 'Failed to parse response' };
  }

  return Response.json({
    success: clobRes.ok,
    status: clobRes.status,
    clob_response: clobData,
    order_struct: orderStruct,
    signer_address: wallet.address,
  });
});