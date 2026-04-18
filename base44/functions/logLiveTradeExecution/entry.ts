import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { order, txHash } = body;

    if (!order) {
      return Response.json({ error: 'Missing order' }, { status: 400 });
    }

    // Extract order details
    const side = order.side === 0 ? 'yes' : 'no';
    const price = order.makerAmount && order.takerAmount
      ? parseFloat(order.makerAmount) / parseFloat(order.takerAmount)
      : 0.5;
    const sizeUsdc = parseFloat(order.makerAmount) / 1e6;

    // Determine asset and contract type from tokenId
    const tokenId = order.tokenId;
    const btcTokenId = '21742633143463906290569050155826241533067272736897614950488156847949938836455';
    const ethTokenId = '69236923620077691027083946871148646972011131466059644796204542240861588995922';
    
    const asset = tokenId === btcTokenId ? 'BTC' : tokenId === ethTokenId ? 'ETH' : 'UNKNOWN';
    const contractType = '5min_up'; // Default; could parse from elsewhere

    // Log as pending trade
    await base44.asServiceRole.entities.BotTrade.create({
      market_title: `${asset} Client Signed Order`,
      asset,
      contract_type: contractType,
      side,
      entry_price: price,
      size_usdc: sizeUsdc,
      shares: Math.round(sizeUsdc / price),
      edge_at_entry: 0,
      confidence_at_entry: 50,
      kelly_fraction_used: 0.5,
      pnl_usdc: 0,
      outcome: 'pending',
      mode: 'live',
      notes: `✅ Client-side signed order · TxHash: ${txHash}`,
    });

    return Response.json({
      success: true,
      message: 'Live trade execution logged',
      txHash,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});