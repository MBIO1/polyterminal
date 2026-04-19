/**
 * walletBalance — fetches USDC balance on Polygon for the configured wallet
 * Checks both bridged USDC.e and native USDC contracts
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const POLYGON_RPC = 'https://polygon-rpc.com';
const USDC_BRIDGED = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC.e (bridged)
const USDC_NATIVE  = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // Native USDC

function encodeBalanceOf(address) {
  const selector = '70a08231';
  const padded = address.replace('0x', '').toLowerCase().padStart(64, '0');
  return '0x' + selector + padded;
}

async function ethCall(contract, data, id) {
  const res = await fetch(POLYGON_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: contract, data }, 'latest'], id }),
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json();
  const hex = json?.result || '0x0';
  return Number(BigInt(hex === '0x' ? '0x0' : hex)) / 1_000_000;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const walletAddress = Deno.env.get('POLY_WALLET_ADDRESS');
  if (!walletAddress) {
    return Response.json({ error: 'POLY_WALLET_ADDRESS not set', balance_usdc: null });
  }

  try {
    const encodedData = encodeBalanceOf(walletAddress);

    // Fetch bridged USDC.e, native USDC, and MATIC in parallel
    const [usdcBridged, usdcNative, maticRes] = await Promise.all([
      ethCall(USDC_BRIDGED, encodedData, 1),
      ethCall(USDC_NATIVE, encodedData, 2),
      fetch(POLYGON_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [walletAddress, 'latest'], id: 3 }),
        signal: AbortSignal.timeout(8000),
      }).then(r => r.json()),
    ]);

    const maticHex = maticRes?.result || '0x0';
    const balance_matic = Number(BigInt(maticHex === '0x' ? '0x0' : maticHex)) / 1e18;

    // Total USDC = bridged + native
    const balance_usdc = parseFloat((usdcBridged + usdcNative).toFixed(2));

    return Response.json({
      wallet: walletAddress,
      balance_usdc,
      balance_usdc_bridged: parseFloat(usdcBridged.toFixed(2)),
      balance_usdc_native: parseFloat(usdcNative.toFixed(2)),
      balance_matic: parseFloat(balance_matic.toFixed(4)),
      gas_ok: balance_matic >= 0.01,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json({ error: err.message, balance_usdc: null, balance_matic: null });
  }
});