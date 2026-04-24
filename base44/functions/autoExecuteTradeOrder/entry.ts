import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { tradeId, action = 'execute' } = await req.json();

    if (!tradeId) {
      return Response.json({ error: 'Missing tradeId' }, { status: 400 });
    }

    // Fetch the trade
    const trade = await base44.asServiceRole.entities.ArbTrade.get(tradeId);
    if (!trade) {
      return Response.json({ error: 'Trade not found', tradeId }, { status: 404 });
    }

    // Check if trade is in executable state
    if (trade.status !== 'Planned' && trade.status !== 'Open') {
      return Response.json({
        error: `Trade status ${trade.status} is not executable`,
        tradeId,
        action: 'manual_review_required',
      }, { status: 400 });
    }

    // Fetch active TradingParameters
    const params = await base44.asServiceRole.entities.TradingParameters.list('-updated_date', 1);
    const activeParam = params?.[0];

    if (!activeParam) {
      return Response.json({
        error: 'No active TradingParameters preset',
        tradeId,
        action: 'manual_review_required',
      }, { status: 400 });
    }

    // Prepare trade update data
    // IMPORTANT: Keep notes field small. For large content, upload and store URL.
    const updateData = {
      status: 'Open',
      entry_timestamp: new Date().toISOString(),
      mode: activeParam.mode || 'paper',
      entry_order_type: activeParam.order_type || 'Market',
      entry_fee_type: 'Taker',
    };

    // Only add small notes
    const briefNotes = `[AUTO] Executed by autoExecuteTradeOrder at ${new Date().toISOString()}`;
    if (briefNotes.length < 500) {
      updateData.notes = briefNotes;
    }

    // Update trade
    await base44.asServiceRole.entities.ArbTrade.update(tradeId, updateData);

    return Response.json({
      ok: true,
      tradeId,
      status: 'Open',
      timestamp: new Date().toISOString(),
      mode: activeParam.mode,
    });
  } catch (error) {
    console.error('autoExecuteTradeOrder error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});