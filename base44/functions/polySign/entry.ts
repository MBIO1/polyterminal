/**
 * polySign — server-side EIP-712 order signing.
 * The private key lives only in POLY_PRIVATE_KEY env var.
 * The browser sends the unsigned order struct; we return the signature.
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

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const privateKey = Deno.env.get('POLY_PRIVATE_KEY');
  if (!privateKey) return Response.json({ error: 'POLY_PRIVATE_KEY not set' }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const struct = body.struct;
  if (!struct) return Response.json({ error: 'Missing struct' }, { status: 400 });

  const wallet = new ethers.Wallet(privateKey);
  const signature = await wallet.signTypedData(EIP712_DOMAIN, ORDER_TYPES, struct);

  return Response.json({ signature, signer: wallet.address });
});