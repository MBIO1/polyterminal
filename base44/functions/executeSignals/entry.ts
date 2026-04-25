// executeSignals — Base44 signal executor (Phase C architecture)
//
// Base44 handles: signal ingestion, risk gating, trade record creation
// Droplet handles: actual Bybit order placement (geo-block workaround)
//
// THREE PILLARS:
//   PILLAR 1 — Staleness: signals older than TTL are expired
//   PILLAR 2 — Real edge: recomputes net edge with fees + slippage. Must be > minEdge to execute.
//   PILLAR 3 — Risk gates: daily drawdown, margin util, kill switch

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_MIN_EDGE = 2.0;
const FEE_BPS_PER_LEG  = 2;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function signalAgeMs(signal) {
  return Date.now() - new Date(signal.received_time || signal.created_date).getTime();
}

function signalConfidence(signal, ttlMs) {
  const ageFraction = Math.min(signalAgeMs(signal) / ttlMs, 1);
  const agePts      = 50 * (1 - ageFraction);
  const confirmed   = Number(signal.confirmed_exchanges || 1);
  const confirmPts  = confirmed >= 3 ? 40 : confirmed >= 2 ? 30 : 15;
  const fillable    = Number(signal.fillable_size_usd || 0);
  const fillPts     = Math.min(fillable / 1000, 1) * 10;
  return Math.min(100, Math.max(0, Math.round(agePts + confirmPts + fillPts)));
}

function sizeMultiplier(confidence) {
  if (confidence >= 80) return 1.00;
  if (confidence >= 60) return 0.50;
  if (confidence >= 40) return 0.25;
  return 0;
}

function recomputeNetEdge(signal, config, sizeUsd) {
  const rawBps   = Math.max(-1000, Math.min(1000, Number(signal.raw_spread_bps || 0)));
  const takerBps = Math.max(0, Math.min(100, Number(config.taker_fee_bps_per_leg ?? FEE_BPS_PER_LEG)));
  const fillable = Math.max(1, Number(signal.fillable_size_usd || 1));
  const sizeRatio= Math.min(Math.max(0, sizeUsd) / fillable, 1);
  const slipBps  = sizeRatio < 0.1 ? 0.5 : sizeRatio < 0.3 ? 1 : sizeRatio < 0.6 ? 1.5 : 2;
  const net      = signal.net_edge_bps != null
    ? Number(signal.net_edge_bps)
    : rawBps - (4 * takerBps) - slipBps;
  return { rawBps, takerBps, slipBps, net };
}

function computeSizeUsd(signal, config, confidence) {
  const totalCap   = Number(config.total_capital || 0);
  const spotBucket = totalCap * Number(config.spot_allocation_pct || 0.35);
  const perTradeCap= spotBucket * 0.10;
  const fillable   = Number(signal.fillable_size_usd || 0);
  const mult       = sizeMultiplier(confidence);
  return Math.max(0, Math.floor(Math.min(perTradeCap, fillable * 0.20) * mult));
}

function paperFill(signal, sizeUsd) {
  const buyPx  = Number(signal.buy_price)  || 0;
  const sellPx = Number(signal.sell_price) || 0;
  if (!buyPx || !sellPx) throw new Error('missing prices in signal');
  const qty = Number((sizeUsd / buyPx).toFixed(6));
  return {
    mode: 'paper',
    fills: { buy: { px: buyPx, qty }, sell: { px: sellPx, qty } },
  };
}

// ─── Droplet proxy execution ──────────────────────────────────────────────────
// Sends order to the droplet's order-server.mjs, which calls Bybit directly.
// This bypasses Bybit's geo-block on Base44's server region.

async function executeViaDroplet(signal, qty) {
  const dropletIp  = Deno.env.get('DROPLET_IP');
  const secret     = Deno.env.get('DROPLET_SECRET');
  const port       = Deno.env.get('ORDER_SERVER_PORT') || '4001';

  if (!dropletIp || !secret) throw new Error('DROPLET_IP or DROPLET_SECRET not configured');

  const url = `http://${dropletIp}:${port}/execute`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secret}` },
    body: JSON.stringify({
      signal_id:    signal.id,
      pair:         signal.pair,
      asset:        signal.asset,
      buy_exchange: signal.buy_exchange,
      sell_exchange:signal.sell_exchange,
      buy_price:    signal.buy_price,
      sell_price:   signal.sell_price,
      net_edge_bps: signal.net_edge_bps,
      qty,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`droplet_http_${res.status}: ${errText.slice(0, 120)}`);
  }

  const json = await res.json().catch(() => { throw new Error('droplet_invalid_response'); });
  if (!json.ok) throw new Error(`droplet_exec_failed: ${json.error || 'unknown'}`);
  return json; // { ok, spotOk, perpOk, spotOrderId, perpOrderId, mode }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user   = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body       = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const dryRun     = body.dry_run === true;
    const forceId    = body.signal_id || null;
    const ttlMs      = Number(body.signal_ttl_ms) || 60_000;
    const maxSignals = Math.min(Number(body.max_signals) || 10, 25);

    // ── Load config ───────────────────────────────────────────────────────────
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config  = configs?.[0];
    if (!config) return Response.json({ error: 'No ArbConfig found' }, { status: 400 });

    if (config.kill_switch_active) {
      return Response.json({ ok: false, halted: true, reason: 'kill_switch_active' });
    }
    if (!config.bot_running && !forceId) {
      return Response.json({ ok: false, halted: true, reason: 'bot_not_running' });
    }

    // Apply min-edge gate in BOTH paper and live so paper P&L reflects realistic economics.
    const minEdge = Math.min(
      Number(config.btc_min_edge_bps ?? DEFAULT_MIN_EDGE),
      Number(config.eth_min_edge_bps ?? DEFAULT_MIN_EDGE),
    );

    // ── Load signals ──────────────────────────────────────────────────────────
    const nowTs     = Date.now();
    const todayStr  = new Date().toISOString().slice(0, 10);
    const recentAll = await base44.asServiceRole.entities.ArbSignal.filter(
      { status: { $in: ['detected', 'alerted'] } }, '-received_time', 100
    );

    let candidates;
    const expiredIds = [];

    if (forceId) {
      const found = recentAll.find(s => s.id === forceId);
      if (!found) return Response.json({ error: `Signal ${forceId} not found` }, { status: 404 });
      candidates = [found];
    } else {
      const fresh = [];
      for (const s of recentAll) {
        if (nowTs - new Date(s.received_time || s.created_date).getTime() > ttlMs) {
          expiredIds.push(s.id);
        } else {
          fresh.push(s);
        }
      }
      if (!dryRun && expiredIds.length > 0) {
        await Promise.all(expiredIds.map(id =>
          base44.asServiceRole.entities.ArbSignal.update(id, { status: 'expired', rejection_reason: 'ttl_exceeded' })
            .catch(e => console.error('expire failed', id, e.message))
        ));
      }
      candidates = fresh.slice(0, maxSignals);
    }

    // ── Risk gates ────────────────────────────────────────────────────────────
    const [closedToday, openPositions] = await Promise.all([
      base44.asServiceRole.entities.ArbTrade.filter({ status: 'Closed', trade_date: todayStr }, '-updated_date', 200),
      base44.asServiceRole.entities.ArbLivePosition.filter({ status: 'Open' }, '-snapshot_time', 50),
    ]);

    const totalCap = Number(config.total_capital || 0);
    const todayPnl = closedToday.reduce((a, t) => a + Number(t.net_pnl || 0), 0);
    const ddCap    = totalCap * Number(config.max_daily_drawdown_pct || 0.01);
    if (todayPnl < -ddCap) {
      return Response.json({ ok: false, halted: true, reason: `daily_drawdown_breach(${todayPnl.toFixed(2)})` });
    }

    const perpBucket    = totalCap * Number(config.perp_collateral_pct || 0.245);
    const marginUsed    = openPositions.reduce((a, p) => a + Number(p.margin_used || 0), 0);
    const marginUtil    = perpBucket > 0 ? marginUsed / perpBucket : 0;
    const maxMarginUtil = Number(config.max_margin_utilization_pct || 0.35);
    if (marginUtil >= maxMarginUtil) {
      return Response.json({ ok: false, halted: true, reason: `margin_util_breach(${(marginUtil*100).toFixed(1)}%)` });
    }

    // ── Score & filter signals ────────────────────────────────────────────────
    const scored = [];
    for (const sig of candidates) {
      const confidence = signalConfidence(sig, ttlMs);
      if (confidence < 40 && !forceId) continue;

      const sizeUsd = computeSizeUsd(sig, config, confidence);
      if (sizeUsd <= 0) continue;

      const { rawBps, takerBps, slipBps, net } = recomputeNetEdge(sig, config, sizeUsd);

      if (net < minEdge && !forceId) {
        console.log(`[executeSignals] REJECT ${sig.pair}: net=${net.toFixed(2)}bps < min=${minEdge}bps`);
        continue;
      }

      const minFill = Number(config.min_fillable_usd || 200);
      if (Number(sig.fillable_size_usd || 0) < minFill && !forceId) continue;

      scored.push({ sig, confidence, sizeUsd, net, rawBps, takerBps, slipBps });
    }

    // Best edge first, one trade per asset
    scored.sort((a, b) => b.net - a.net);
    const seenAssets = new Set();
    const toExecute  = [];
    for (const s of scored) {
      if (seenAssets.has(s.sig.asset)) continue;
      seenAssets.add(s.sig.asset);
      toExecute.push(s);
    }

    // ── Execute ───────────────────────────────────────────────────────────────
    const results    = [];
    let tradeCounter = 1;

    for (const { sig, confidence, sizeUsd, net, rawBps, takerBps, slipBps } of toExecute) {
      const condition = confidence >= 80 ? 'HEALTHY' : confidence >= 60 ? 'VOLATILE' : 'UNCERTAIN';

      if (dryRun) {
        results.push({ signal_id: sig.id, pair: sig.pair, decision: 'would_execute', size_usd: sizeUsd, confidence, condition, net_bps: net });
        continue;
      }

      const buyPx    = Number(sig.buy_price) || 0;
      const sellPx   = Number(sig.sell_price) || 0;
      if (!buyPx) {
        results.push({ signal_id: sig.id, pair: sig.pair, decision: 'error', error: 'missing_buy_price' });
        continue;
      }

      const qty      = Number((sizeUsd / buyPx).toFixed(6));
      const isLive   = !config.paper_trading;

      let execResult;
      try {
        if (isLive) {
          const dropletResult = await executeViaDroplet(sig, qty);
          execResult = {
            mode:  dropletResult.mode || (dropletResult.spotOk && dropletResult.perpOk ? 'live' : 'live_partial'),
            fills: { buy: { px: buyPx, qty }, sell: { px: sellPx, qty } },
            droplet: dropletResult,
          };
        } else {
          execResult = paperFill(sig, sizeUsd);
        }
      } catch (e) {
        const safeMsg = e.message?.slice(0, 120) || 'unknown_error';
        console.error(`[executeSignals] exec error signal ${sig.id}:`, safeMsg);
        await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
          status: 'rejected', rejection_reason: `exec_error:${safeMsg}`,
        });
        results.push({ signal_id: sig.id, pair: sig.pair, decision: 'error', error: safeMsg });
        continue;
      }

      // ── Build trade record ────────────────────────────────────────────────
      const notional   = qty * buyPx;
      const grossSpread= sellPx - buyPx;
      const perLegFee  = notional * (takerBps / 10000);
      const feeTotal   = perLegFee * 4;
      const slipTotal  = notional * (slipBps / 10000);
      const basisPnl   = qty * grossSpread;
      const netPnl     = basisPnl - feeTotal - slipTotal;

      const rootOf     = v => v.replace(/-(spot|perp|swap|futures)$/i, '').trim();
      const buyRoot    = rootOf(String(sig.buy_exchange  || ''));
      const sellRoot   = rootOf(String(sig.sell_exchange || ''));
      const buyIsPerp  = /perp|swap|futures/i.test(sig.buy_exchange  || '');
      const sellIsPerp = /perp|swap|futures/i.test(sig.sell_exchange || '');
      const sameVenue  = buyRoot === sellRoot && buyRoot !== '';

      let strategy, spotExchange, perpExchange, spotEntryPx, perpEntryPx, direction;
      if (sameVenue && buyIsPerp !== sellIsPerp) {
        strategy     = 'Same-venue Spot/Perp Carry';
        spotExchange = buyRoot;
        perpExchange = buyRoot;
        spotEntryPx  = buyIsPerp ? sellPx : buyPx;
        perpEntryPx  = buyIsPerp ? buyPx  : sellPx;
        direction    = buyIsPerp ? `Long ${buyRoot} perp / Short ${buyRoot} spot` : `Long ${buyRoot} spot / Short ${buyRoot} perp`;
      } else if (buyIsPerp && sellIsPerp) {
        strategy     = 'Cross-venue Perp/Perp';
        perpExchange = `${buyRoot}/${sellRoot}`;
        spotExchange = null;
        perpEntryPx  = buyPx;
        direction    = `Buy ${sig.buy_exchange} / Sell ${sig.sell_exchange}`;
      } else {
        strategy     = 'Cross-venue Spot Spread';
        spotExchange = `${buyRoot}/${sellRoot}`;
        perpExchange = null;
        spotEntryPx  = buyPx;
        direction    = `Buy ${sig.buy_exchange} / Sell ${sig.sell_exchange}`;
      }

      const d = execResult.droplet;
      const tradeIdSuffix = `${Date.now().toString(36)}-${tradeCounter++}`;
      const trade = await base44.asServiceRole.entities.ArbTrade.create({
        trade_id:           `AUTO-${tradeIdSuffix}`,
        trade_date:         todayStr,
        entry_timestamp:    new Date().toISOString(),
        exit_timestamp:     new Date().toISOString(),
        status:             'Closed',
        strategy,
        asset:              sig.asset || 'Other',
        spot_exchange:      spotExchange,
        perp_exchange:      perpExchange,
        direction,
        spot_entry_px:      spotEntryPx || null,
        perp_entry_px:      perpEntryPx || null,
        spot_exit_px:       null,
        perp_exit_px:       null,
        spot_qty:           qty,
        perp_qty:           perpEntryPx ? qty : null,
        gross_spread_entry: grossSpread,
        entry_spread_bps:   rawBps,
        exit_spread_bps:    0,
        spot_entry_fee:     perLegFee,
        spot_exit_fee:      perLegFee,
        perp_entry_fee:     perpEntryPx ? perLegFee : null,
        perp_exit_fee:      perpEntryPx ? perLegFee : null,
        expected_slippage:  slipTotal,
        realized_slippage:  slipTotal,
        total_realized_fees: feeTotal + slipTotal,
        basis_pnl:          basisPnl,
        net_pnl:            netPnl,
        net_pnl_bps:        notional > 0 ? (netPnl / notional) * 10000 : 0,
        allocated_capital:  notional,
        entry_order_type:   'Market',
        exit_order_type:    'Market',
        entry_fee_type:     'Taker',
        exit_fee_type:      'Taker',
        mode:               isLive ? 'live' : 'paper',
        review_notes:       d ? `spotOrderId=${d.spotOrderId} perpOrderId=${d.perpOrderId} spotOk=${d.spotOk} perpOk=${d.perpOk} mode=${d.mode}` : undefined,
        entry_thesis:       `Auto-executed signal ${sig.id} | net=${net.toFixed(2)}bps | confidence=${confidence}% | condition=${condition}`.trim(),
        net_delta_usd:      0,
        borrow_conversion_cost: 0,
      });

      await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
        status:           'executed',
        executed_pnl_bps: trade.net_pnl_bps,
        executed_pnl_usd: netPnl,
        win:              netPnl > 0,
        notes:            `trade=${trade.trade_id} confidence=${confidence}% condition=${condition}`,
      });

      console.log(`[executeSignals] EXECUTED ${sig.pair} | trade=${trade.trade_id} | net=${net.toFixed(2)}bps | mode=${execResult.mode}`);

      results.push({
        signal_id: sig.id,
        pair:      sig.pair,
        decision:  'executed',
        mode:      execResult.mode,
        trade_id:  trade.trade_id,
        size_usd:  Math.round(notional),
        net_bps:   Number(net.toFixed(2)),
        net_pnl_usd: Number(netPnl.toFixed(4)),
        confidence,
        condition,
        ...(d ? { spot_order_id: d.spotOrderId, perp_order_id: d.perpOrderId, spot_ok: d.spotOk, perp_ok: d.perpOk } : {}),
      });
    }

    return Response.json({
      ok:                  true,
      dry_run:             dryRun,
      paper_trading:       config.paper_trading !== false,
      candidates_received: candidates.length,
      to_execute:          toExecute.length,
      executed:            results.filter(r => r.decision === 'executed').length,
      rejected_edge:       candidates.length - scored.length,
      expired:             expiredIds.length,
      results,
    });

  } catch (error) {
    const safeError = (error.message || 'fatal_error').slice(0, 100);
    console.error('[executeSignals] fatal error:', safeError);
    return Response.json({ error: 'execution_service_error' }, { status: 500 });
  }
});