// analyzeFundingProfitability — validates that funding positions cover all fees
// Returns detailed breakdown: expected funding vs total fees, net edge after costs
// Used by executeFundingPositions to gate entry/exit decisions

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const config = (await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1))[0];
    if (!config) return Response.json({ error: 'No config found' }, { status: 400 });

    // Fee structure from config
    const spotMakerFee = Number(config.spot_maker_fee ?? 0.0002);
    const spotTakerFee = Number(config.spot_taker_fee ?? 0.0004);
    const perpMakerFee = Number(config.perp_maker_fee ?? 0.0002);
    const perpTakerFee = Number(config.perp_taker_fee ?? 0.0004);

    // Analyze all open funding positions
    const openPos = await base44.asServiceRole.entities.ArbLivePosition.filter(
      { status: 'Open' },
      '-snapshot_time',
      100
    );

    const fundingTrades = await base44.asServiceRole.entities.ArbTrade.filter(
      { status: 'Open', strategy: 'Funding Capture' },
      '-entry_timestamp',
      100
    );

    const analysis = [];
    for (const pos of openPos) {
      if (!pos.linked_trade_id) continue;

      const trade = fundingTrades.find(t => t.id === pos.linked_trade_id);
      if (!trade) continue;

      // Total notional (worst case: both legs as taker)
      const spotNotional = Math.abs(pos.spot_qty * pos.spot_mark);
      const perpNotional = Math.abs(pos.perp_qty * pos.perp_mark);

      // Assume taker fees on entry + exit (conservative)
      const entrySpotFee = spotNotional * spotTakerFee;
      const entryPerpFee = perpNotional * perpTakerFee;
      const exitSpotFee = spotNotional * spotTakerFee;
      const exitPerpFee = perpNotional * perpTakerFee;

      const totalFeesUsd = entrySpotFee + entryPerpFee + exitSpotFee + exitPerpFee;

      // Expected funding (per 8h cycle) × estimated hold time
      const fundingPaymentPerCycle = Math.abs(pos.spot_qty * pos.spot_mark) * Math.abs(Number(pos.funding_next || 0));
      
      // Assume holding for 24 hours = 3 funding cycles
      const estimatedFunding24h = fundingPaymentPerCycle * 3;

      // Net edge (funding - fees)
      const netEdgeUsd = estimatedFunding24h - totalFeesUsd;
      const netEdgePct = spotNotional > 0 ? (netEdgeUsd / spotNotional) * 100 : 0;

      const isProfitable = netEdgeUsd > 0;

      analysis.push({
        asset: pos.asset,
        venue: pos.perp_exchange,
        trade_id: trade.trade_id,
        spot_notional: spotNotional.toFixed(2),
        perp_notional: perpNotional.toFixed(2),
        entry_spot_fee: entrySpotFee.toFixed(4),
        entry_perp_fee: entryPerpFee.toFixed(4),
        exit_spot_fee: exitSpotFee.toFixed(4),
        exit_perp_fee: exitPerpFee.toFixed(4),
        total_fees_usd: totalFeesUsd.toFixed(2),
        funding_rate: Number(pos.funding_next || 0).toFixed(6),
        estimated_funding_24h: estimatedFunding24h.toFixed(2),
        net_edge_usd: netEdgeUsd.toFixed(2),
        net_edge_pct: netEdgePct.toFixed(4),
        profitable: isProfitable,
        risk_level: isProfitable && netEdgeUsd > totalFeesUsd ? 'LOW' : isProfitable ? 'MEDIUM' : 'HIGH_LOSS',
      });
    }

    // Summary stats
    const profitable = analysis.filter(a => a.profitable).length;
    const totalFees = analysis.reduce((sum, a) => sum + Number(a.total_fees_usd), 0);
    const totalFunding = analysis.reduce((sum, a) => sum + Number(a.estimated_funding_24h), 0);

    return Response.json({
      ok: true,
      timestamp: new Date().toISOString(),
      summary: {
        open_positions: analysis.length,
        profitable_positions: profitable,
        total_expected_funding_24h: totalFunding.toFixed(2),
        total_fees_24h: totalFees.toFixed(2),
        net_profit_24h: (totalFunding - totalFees).toFixed(2),
        overall_status: profitable > 0 && totalFunding > totalFees ? 'HEALTHY' : 'RISK',
      },
      positions: analysis.sort((a, b) => Number(b.net_edge_usd) - Number(a.net_edge_usd)),
    });
  } catch (error) {
    console.error('analyzeFundingProfitability error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});