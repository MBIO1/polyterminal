/**
 * walletBalance — fetches USDC balance on Polygon for the configured wallet
 * Uses Polygon RPC directly (public endpoint, no proxy needed)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const POLYGON_RPC = 'https://polygon-rpc.com';
// USDC on Polygon
const USDC_CONTRACT = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
// ERC-20 balanceOf ABI encoded selector
function encodeBalanceOf(address) {
  // balanceOf(address) = 0x70a08231
  const selector = '70a08231';
  const padded = address.replace('0x', '').toLowerCase().padStart(64, '0');
  return '0x' + selector + padded;
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
    // Call USDC balanceOf via eth_call
    const rpcRes = await fetch(POLYGON_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: USDC_CONTRACT, data: encodeBalanceOf(walletAddress) }, 'latest'],
        id: 1,
      }),
      signal: AbortSignal.timeout(8000),
    });

    const rpcData = await rpcRes.json();
    const hex = rpcData?.result || '0x0';
    const raw = BigInt(hex === '0x' ? '0x0' : hex);
    // USDC has 6 decimals on Polygon
    const balance_usdc = Number(raw) / 1_000_000;

    // Also fetch MATIC balance for gas
    const maticRes = await fetch(POLYGON_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [walletAddress, 'latest'],
        id: 2,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const maticData = await maticRes.json();
    const maticHex = maticData?.result || '0x0';
    const maticRaw = BigInt(maticHex === '0x' ? '0x0' : maticHex);
    const balance_matic = Number(maticRaw) / 1e18;

    return Response.json({
      wallet: walletAddress,
      balance_usdc: parseFloat(balance_usdc.toFixed(2)),
      balance_matic: parseFloat(balance_matic.toFixed(4)),
      gas_ok: balance_matic >= 0.01,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json({ error: err.message, balance_usdc: null, balance_matic: null });
  }
});