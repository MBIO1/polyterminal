/**
 * autoExecuteTradeOrder — Triggered by BotTrade entity automation (create/update with mode='live')
 * 1. Fetches active TradingParameters preset
 * 2. Validates if trade meets edge/confidence thresholds
 * 3. If valid, calls polyPlaceOrder to execute on CLOB
 * 4. Updates BotTrade with order status and execution details
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const body = await req.json().catch(() => ({}));
  const { event, data } = body;

  // Only process live mode trades
  if (data?.mode !== 'live') {
    return Response.json({ skipped: true, reason: 'not live mode' });
  }

  try {
    // Get active TradingParameters preset
    const presets = await base44.asServiceRole.entities.TradingParameters.filter({ is_active: true });
    const activePreset = presets[0];

    if (!activePreset) {
      return Response.json({ 
        error: 'No active TradingParameters preset', 
        tradeId: data.id,
        action: 'manual_review_required' 
      }, { status: 400 });
    }

    // Validate thresholds
    const edgePass = (data.edge_at_entry || 0) >= activePreset.edge_threshold;
    const confPass = (data.confidence_at_entry || 0) >= activePreset.confidence_threshold;

    if (!edgePass || !confPass) {
      const updates = {
        notes: `${data.notes || ''} | ⚠️ Blocked: edge=${edgePass ? '✓' : '✗'} conf=${confPass ? '✓' : '✗'}`,
      };
      await base44.asServiceRole.entities.BotTrade.update(data.id, updates);
      return Response.json({ 
        rejected: true, 
        reason: `edge=${edgePass},conf=${confPass}`,
        tradeId: data.id,
      });
    }

    // Build CLOB order payload
    // Map contract type to Polymarket token IDs
    const tokenMap = {
      '5min_up': {
        'BTC': '21742633143463906290569050155826241533067272736897614950488156847949938836455',
        'ETH': '69236923620077691027083946871148646972011131466059644796204542240861588995922',
      },
      '5min_down': {
        'BTC': '48331043336612883890938759509493159234755048973500640148014422747788308965732',
        'ETH': '87584955359245246404952128082451897287778571240979823316620093987046202296587',
      },
      '15min_up': {
        'BTC': '21742633143463906290569050155826241533067272736897614950488156847949938836455',
        'ETH': '69236923620077691027083946871148646972011131466059644796204542240861588995922',
      },
      '15min_down': {
        'BTC': '48331043336612883890938759509493159234755048973500640148014422747788308965732',
        'ETH': '87584955359245246404952128082451897287778571240979823316620093987046202296587',
      },
    };

    const tokenId = tokenMap[data.contract_type]?.[data.asset];
    if (!tokenId) {
      throw new Error(`Unknown contract type: ${data.contract_type}`);
    }

    // Determine side: if edge signals YES higher than NO price, buy YES
    const side = data.side === 'yes' ? 'BUY' : 'SELL';

    // Call polyPlaceOrder function
    const orderRes = await base44.asServiceRole.functions.invoke('polyPlaceOrder', {
      tokenId,
      side,
      price: data.entry_price,
      sizeUsdc: data.size_usdc,
      expirySecs: 300, // 5 min GTC
    });

    if (!orderRes.success) {
      const updates = {
        notes: `${data.notes || ''} | ❌ Order failed: ${orderRes.error || 'unknown'}`,
      };
      await base44.asServiceRole.entities.BotTrade.update(data.id, updates);
      return Response.json({ 
        error: 'Order placement failed',
        tradeId: data.id,
        details: orderRes,
      }, { status: 500 });
    }

    // Order succeeded—update BotTrade with execution details
    const updates = {
      notes: `${data.notes || ''} | ✅ Order placed: ${side} ${data.size_usdc}$ @ ${(data.entry_price * 100).toFixed(0)}¢ [${data.contract_type}]`,
    };
    await base44.asServiceRole.entities.BotTrade.update(data.id, updates);

    return Response.json({
      success: true,
      tradeId: data.id,
      orderResponse: orderRes,
      preset: activePreset.name,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});