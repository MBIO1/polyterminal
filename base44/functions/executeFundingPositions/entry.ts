// executeFundingPositions — opens/closes delta-neutral funding capture positions.
//
// Entry: scans ArbFundingOpportunity for rates qualifying (|apr| >= funding_min_apr_bps).
//        Opens a spot + perp pair: long spot + short perp if positive, vice versa if negative.
//
// Exit: closes if:
//   1. APR drops below funding_exit_apr_bps, OR
//   2. APR flips sign (if funding_exit_on_flip=true), OR
//   3. Manual close via API
//
// Records everything to ArbLivePosition and ArbTrade for tracking.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// NOTE: Removed stale getLatestFundingRates() — it used the wrong host (api.okx.com → 404).
// Latest rates are loaded from ArbFundingOpportunity entity (written by scanFunding).

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const config = (await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1))[0];
    if (!config || !config.funding_enabled) {
      return Response.json({ ok: true, message: 'Funding disabled in config', entries: 0, exits: 0 });
    }

    const minAprBps = Number(config.funding_min_apr_bps ?? 1000);
    const exitAprBps = Number(config.funding_exit_apr_bps ?? 500);
    const exitOnFlip = config.funding_exit_on_flip !== false;
    const maxPosUsd = Number(config.funding_max_position_usd ?? 200);

    // AUTO-SCALING: Calculate cumulative realized funding gains from closed positions
    const closedTrades = await base44.asServiceRole.entities.ArbTrade.filter(
      { status: 'Closed', strategy: 'Funding Capture' },
      '-exit_timestamp',
      100
    );
    let totalRealizedFunding = 0;
    const scalingThreshold = maxPosUsd * 0.2; // 20% of current cap
    for (const t of closedTrades) {
      const realized = Number(t.realized_funding || 0);
      if (realized > 0) totalRealizedFunding += realized;
    }
    
    // If gains exceed 20% of cap, scale up by 50%
    let scaledMaxPosUsd = maxPosUsd;
    if (totalRealizedFunding >= scalingThreshold && totalRealizedFunding > 0) {
      scaledMaxPosUsd = Math.round(maxPosUsd * 1.5);
      // Update config to persist the new cap
      await base44.asServiceRole.entities.ArbConfig.update(config.id, {
        funding_max_position_usd: scaledMaxPosUsd,
      });
      console.log(`[AUTO-SCALE] Funding cap scaled from $${maxPosUsd} to $${scaledMaxPosUsd} (realized: $${totalRealizedFunding.toFixed(2)})`);
    }

    // Load latest opportunities (most recent snapshot per venue+pair)
    const allOpps = await base44.asServiceRole.entities.ArbFundingOpportunity.list('-snapshot_time', 100);
    const latest = {};
    for (const o of allOpps) {
      const k = `${o.venue}|${o.pair}`;
      if (!latest[k] || new Date(o.snapshot_time) > new Date(latest[k].snapshot_time)) {
        latest[k] = o;
      }
    }
    const qualifyingOpps = Object.values(latest).filter(o => Math.abs(o.annualized_apr_bps) >= minAprBps);

    // Load open positions
    const openPos = await base44.asServiceRole.entities.ArbLivePosition.filter({ status: 'Open' }, '-snapshot_time', 50);

    // EXITS: check open positions for exit conditions
    const exitsToProcess = [];
    for (const pos of openPos) {
      if (!pos.linked_trade_id) continue; // skip if not linked to a funding trade
      const key = `${pos.perp_exchange}|${pos.asset}-USDT`;
      const currentRate = latest[key];
      
      if (!currentRate) {
        // If we can't fetch current rate, hold the position (don't exit on stale data)
        continue;
      }

      const shouldExit = 
        (Math.abs(currentRate.annualized_apr_bps) < exitAprBps) ||  // APR dropped below exit threshold
        (exitOnFlip && Math.sign(currentRate.annualized_apr_bps) !== Math.sign(pos.entry_apr || currentRate.annualized_apr_bps));  // sign flipped

      if (shouldExit) {
        exitsToProcess.push({ pos, currentRate, reason: 'funding_exit_criteria_met' });
      }
    }

    // Process exits (close positions, record trades)
    for (const { pos, currentRate, reason } of exitsToProcess) {
      // Mark position as Closing
      await base44.asServiceRole.entities.ArbLivePosition.update(pos.id, {
        status: 'Closing',
        snapshot_time: new Date().toISOString(),
      });

      // Record exit trade (paper-only for now, since we don't have Bybit live execution context here)
      const exitTrade = await base44.asServiceRole.entities.ArbTrade.create({
        trade_id: `FUNDING-EXIT-${Date.now().toString(36)}`,
        trade_date: new Date().toISOString().slice(0, 10),
        entry_timestamp: pos.linked_trade_id ? new Date(pos.snapshot_time).toISOString() : null,
        exit_timestamp: new Date().toISOString(),
        status: 'Closed',
        strategy: 'Funding Capture',
        asset: pos.asset,
        spot_exchange: pos.spot_exchange,
        perp_exchange: pos.perp_exchange,
        direction: pos.spot_qty > 0 ? 'Long spot / Short perp' : 'Short spot / Long perp',
        spot_qty: pos.spot_qty,
        perp_qty: pos.perp_qty,
        spot_entry_px: pos.spot_entry_px,
        spot_exit_px: pos.spot_mark,
        perp_entry_px: pos.perp_entry_px,
        perp_exit_px: pos.perp_mark,
        expected_funding: pos.funding_next,
        realized_funding: pos.funding_next,  // approx
        basis_pnl: (pos.spot_qty || 0) * ((pos.spot_mark || 0) - (pos.spot_entry_px || 0)) +
                   (pos.perp_qty || 0) * ((pos.perp_mark || 0) - (pos.perp_entry_px || 0)),
        entry_thesis: `Funding exit: ${reason}. APR was ${pos.entry_apr}bps, now ${currentRate.annualized_apr_bps.toFixed(2)}bps`,
        exit_reason: reason,
        mode: 'paper',
      });

      // Mark position closed
      await base44.asServiceRole.entities.ArbLivePosition.update(pos.id, {
        status: 'Closed',
        linked_trade_id: exitTrade.id,
        snapshot_time: new Date().toISOString(),
      });
    }

    // ENTRIES: open new positions for qualifying opportunities
    const existingPairs = new Set(openPos.map(p => `${p.perp_exchange}|${p.asset}`));
    const entriesToProcess = qualifyingOpps
      .filter(o => !existingPairs.has(`${o.venue}|${o.asset}`))  // Don't double-open
      .slice(0, 3);  // Limit entries per run

    for (const opp of entriesToProcess) {
      const posSize = scaledMaxPosUsd;
      const mark = Number(opp.mark_price || 0);
      if (!mark) continue;

      const qty = posSize / mark;
      const isLongSpot = opp.annualized_apr_bps > 0;  // positive = long spot, short perp

      // Create ArbLivePosition
      const livePos = await base44.asServiceRole.entities.ArbLivePosition.create({
        snapshot_time: new Date().toISOString(),
        asset: opp.asset,
        spot_exchange: opp.venue,
        perp_exchange: opp.venue,
        spot_qty: isLongSpot ? qty : -qty,
        perp_qty: isLongSpot ? -qty : qty,
        spot_mark: mark,
        perp_mark: mark,
        spot_notional: qty * mark,
        perp_notional: qty * mark,
        net_delta_usd: 0,  // delta-neutral
        collateral_balance: posSize,
        margin_used: posSize * 0.1,  // assume 10% initial margin
        margin_utilization_pct: 0.1,
        liq_distance_pct: 0.9,
        funding_next: (qty * Number(opp.funding_rate || 0)).toFixed(2),
        status: 'Open',
        entry_apr: opp.annualized_apr_bps,
        notes: `Auto-opened funding capture: ${opp.venue} ${opp.pair} @ ${(Math.abs(opp.annualized_apr_bps) / 100).toFixed(2)}% APR`,
      });

      // Create entry trade record
      await base44.asServiceRole.entities.ArbTrade.create({
        trade_id: `FUNDING-ENTRY-${Date.now().toString(36)}`,
        trade_date: new Date().toISOString().slice(0, 10),
        entry_timestamp: new Date().toISOString(),
        status: 'Open',
        strategy: 'Funding Capture',
        asset: opp.asset,
        spot_exchange: opp.venue,
        perp_exchange: opp.venue,
        direction: isLongSpot ? 'Long spot / Short perp' : 'Short spot / Long perp',
        spot_qty: isLongSpot ? qty : -qty,
        perp_qty: isLongSpot ? -qty : qty,
        spot_entry_px: mark,
        perp_entry_px: mark,
        allocated_capital: posSize,
        expected_funding: opp.funding_rate,
        entry_thesis: `Funding capture entry: ${opp.pair} @ ${(Math.abs(opp.annualized_apr_bps) / 100).toFixed(2)}% APR (${opp.annualized_apr_bps > 0 ? 'long spot / short perp' : 'short spot / long perp'})`,
        entry_order_type: 'Market',
        mode: 'paper',
      });
    }

    return Response.json({
      ok: true,
      config_min_apr_bps: minAprBps,
      config_exit_apr_bps: exitAprBps,
      exit_on_flip: exitOnFlip,
      max_pos_usd_original: maxPosUsd,
      max_pos_usd_scaled: scaledMaxPosUsd,
      auto_scale_triggered: scaledMaxPosUsd > maxPosUsd,
      total_realized_funding: totalRealizedFunding.toFixed(2),
      scaling_threshold: scalingThreshold.toFixed(2),
      qualifying_opportunities: qualifyingOpps.length,
      entries: entriesToProcess.length,
      exits: exitsToProcess.length,
      top_opps: qualifyingOpps.slice(0, 5).map(o => ({
        venue: o.venue,
        pair: o.pair,
        apr_bps: o.annualized_apr_bps,
        direction: o.direction,
      })),
    });
  } catch (error) {
    console.error('executeFundingPositions error:', error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});