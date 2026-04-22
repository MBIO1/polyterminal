// Auto-executor: pulls qualifying ArbSignal rows, validates against ArbConfig gates,
// and either (a) routes the trade to a connected exchange API or (b) records a paper fill.
//
// Currently supports LIVE execution on Bybit only (the one exchange with keys configured).
// All other venues are routed as paper fills until their keys are added. The function also
// respects config.paper_trading — if true, nothing goes live regardless of keys.
//
// POST body (all optional):
//   { dry_run: false, max_signals: 5, min_confirmed: 3 }
//
// Returns a summary of processed signals with per-signal decision + outcome.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ---------- Bybit V5 signed request helpers ----------
async function bybitSign(preSign, apiSecret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(preSign));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function bybitPost(path, body) {
  const isTestnet = (Deno.env.get('BYBIT_TESTNET') || 'true').toLowerCase() !== 'false';
  const base = isTestnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
  const apiKey = Deno.env.get('BYBIT_API_KEY');
  const apiSecret = Deno.env.get('BYBIT_API_SECRET');
  if (!apiKey || !apiSecret) throw new Error('Bybit keys not configured');

  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const bodyStr = JSON.stringify(body);
  const preSign = timestamp + apiKey + recvWindow + bodyStr;
  const signature = await bybitSign(preSign, apiSecret);

  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'Content-Type': 'application/json',
    },
    body: bodyStr,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { httpStatus: res.status, body: json, environment: isTestnet ? 'testnet' : 'mainnet' };
}

// Place a Bybit spot or perp market order. category: 'spot' | 'linear'
async function bybitPlaceOrder({ category, symbol, side, qty }) {
  const body = {
    category,
    symbol,
    side,              // 'Buy' | 'Sell'
    orderType: 'Market',
    qty: String(qty),
    timeInForce: 'IOC',
  };
  return await bybitPost('/v5/order/create', body);
}

// ---------- Gate checks ----------
function checkGates({ signal, config, todayPnl, openPositions }) {
  const reasons = [];

  if (config.kill_switch_active) reasons.push('kill_switch_active');
  if (!config.bot_running) reasons.push('bot_not_running');

  const now = Date.now();
  if (config.halt_until_ts && config.halt_until_ts > now) reasons.push('halt_active');

  // Edge threshold: hard-coded 20 bps absolute floor applied to ALL assets.
  // Config per-asset gates can only RAISE the floor, never lower it below 20.
  // This matches the droplet's MIN_NET_EDGE_BPS and the Telegram alert threshold.
  const HARD_FLOOR_BPS = 20;
  const asset = signal.asset || 'Other';
  const assetGate =
    asset === 'BTC' ? Number(config.btc_min_edge_bps || 0) :
    asset === 'ETH' ? Number(config.eth_min_edge_bps || 0) :
    Math.max(Number(config.btc_min_edge_bps || 0), Number(config.eth_min_edge_bps || 0));
  const minEdge = Math.max(HARD_FLOOR_BPS, assetGate);
  if (Number(signal.net_edge_bps || 0) < minEdge) {
    reasons.push(`edge_below_min(${signal.net_edge_bps}<${minEdge})`);
  }

  // Daily drawdown cap
  const totalCap = Number(config.total_capital || 0);
  const ddCap = totalCap * Number(config.max_daily_drawdown_pct || 0);
  if (todayPnl < -ddCap) reasons.push(`daily_drawdown_breach(${todayPnl.toFixed(2)})`);

  // Margin utilization (sum of open positions' margin_used vs perp collateral bucket)
  const perpBucket = totalCap * Number(config.perp_collateral_pct || 0);
  const marginUsed = (openPositions || []).reduce((a, p) => a + Number(p.margin_used || 0), 0);
  const marginUtil = perpBucket > 0 ? marginUsed / perpBucket : 0;
  if (marginUtil >= Number(config.max_margin_utilization_pct || 1)) {
    reasons.push(`margin_util_breach(${(marginUtil * 100).toFixed(1)}%)`);
  }

  // Net delta drift
  const netDelta = (openPositions || []).reduce((a, p) => a + Number(p.net_delta_usd || 0), 0);
  const deltaCap = totalCap * Number(config.max_net_delta_drift_pct || 1);
  if (Math.abs(netDelta) > deltaCap) {
    reasons.push(`delta_drift_breach(${netDelta.toFixed(2)})`);
  }

  // Liquidity check
  const minFill = 1000; // below $1k fillable is not worth the transaction cost
  if (Number(signal.fillable_size_usd || 0) < minFill) {
    reasons.push(`insufficient_liquidity(${signal.fillable_size_usd})`);
  }

  return { allowed: reasons.length === 0, reasons };
}

// Decide trade sizing: allocate a fraction of spot bucket, capped by fillable size
function sizeTrade({ signal, config }) {
  const totalCap = Number(config.total_capital || 0);
  const spotBucket = totalCap * Number(config.spot_allocation_pct || 0);
  // Per-trade cap = single-trade-loss cap / expected slippage of 2x stress multiplier
  // Simpler: use 10% of spot bucket per signal, capped by fillable
  const perTradeCap = spotBucket * 0.10;
  const fillable = Number(signal.fillable_size_usd || 0);
  const sizeUsd = Math.min(perTradeCap, fillable);
  return Math.max(0, Math.floor(sizeUsd));
}

// ---------- Execution ----------
// Route: only Bybit gets live orders. Everything else returns a simulated fill.
async function routeExecution({ signal, sizeUsd, paperTrading }) {
  const asset = signal.asset || 'BTC';
  const symbol = `${asset}USDT`;
  const buyVenue = (signal.buy_exchange || '').toLowerCase();
  const sellVenue = (signal.sell_exchange || '').toLowerCase();

  const buyPx = Number(signal.buy_price) || 0;
  const sellPx = Number(signal.sell_price) || 0;
  if (!buyPx || !sellPx) throw new Error('missing prices');

  const qty = Number((sizeUsd / buyPx).toFixed(6));

  // If paper mode OR neither leg is on Bybit, simulate
  const bybitIsBuy = buyVenue === 'bybit';
  const bybitIsSell = sellVenue === 'bybit';
  const liveCapable = !paperTrading && (bybitIsBuy || bybitIsSell);

  if (!liveCapable) {
    return {
      mode: 'paper',
      reason: paperTrading ? 'config.paper_trading=true' : 'no_bybit_leg_or_no_keys',
      fills: {
        buy: { venue: signal.buy_exchange, px: buyPx, qty, notional_usd: qty * buyPx },
        sell: { venue: signal.sell_exchange, px: sellPx, qty, notional_usd: qty * sellPx },
      },
    };
  }

  // Live: one leg on Bybit, other leg simulated (until that exchange connector exists)
  const liveLeg = bybitIsBuy
    ? { venue: 'Bybit', side: 'Buy', px: buyPx }
    : { venue: 'Bybit', side: 'Sell', px: sellPx };
  const simLeg = bybitIsBuy
    ? { venue: signal.sell_exchange, side: 'Sell', px: sellPx }
    : { venue: signal.buy_exchange, side: 'Buy', px: buyPx };

  const live = await bybitPlaceOrder({
    category: 'spot', symbol, side: liveLeg.side, qty,
  });

  const retCode = live?.body?.retCode;
  const ok = retCode === 0;
  return {
    mode: 'live_partial',
    fills: {
      [liveLeg.side.toLowerCase()]: {
        venue: 'Bybit', px: liveLeg.px, qty, notional_usd: qty * liveLeg.px,
        order_id: live?.body?.result?.orderId,
        retCode, retMsg: live?.body?.retMsg,
        environment: live.environment,
      },
      [simLeg.side.toLowerCase()]: {
        venue: simLeg.venue, px: simLeg.px, qty, notional_usd: qty * simLeg.px,
        simulated: true, note: 'no API connector for this venue yet',
      },
    },
    bybit_ok: ok,
  };
}

// ---------- Main ----------
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const dryRun = body.dry_run === true;
    const maxSignals = Math.min(Number(body.max_signals || 5), 20);
    // Confirmation policy: cross-venue trades need 2, same-venue carries need only 1
    // (a same-venue spot/perp basis trade is structurally complete on one exchange).
    const minConfirmedCross = Number(body.min_confirmed || 2);

    // Load config
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config = configs?.[0]?.data ? configs[0].data : configs?.[0];
    if (!config) return Response.json({ error: 'No ArbConfig found' }, { status: 400 });

    // Load candidate signals: recent, detected/alerted, not yet executed
    const recentAll = await base44.asServiceRole.entities.ArbSignal.list('-received_time', 50);
    // Strip "-spot"/"-perp" suffix to compare venue roots (e.g. "OKX-spot" vs "OKX-perp" = same root "OKX")
    const venueRoot = (v) => String(v || '').replace(/-(spot|perp|swap|futures)$/i, '').trim().toLowerCase();
    const candidates = recentAll
      .filter(s => ['detected', 'alerted'].includes(s.status))
      .filter(s => {
        const sameVenue = venueRoot(s.buy_exchange) === venueRoot(s.sell_exchange) && venueRoot(s.buy_exchange) !== '';
        const required = sameVenue ? 1 : minConfirmedCross;
        return Number(s.confirmed_exchanges || 0) >= required;
      })
      .slice(0, maxSignals);

    // Today's realized PnL from closed trades
    const todayStr = new Date().toISOString().slice(0, 10);
    const closedToday = await base44.asServiceRole.entities.ArbTrade.filter(
      { status: 'Closed', trade_date: todayStr }, '-updated_date', 100,
    );
    const todayPnl = closedToday.reduce((a, t) => a + Number(t.net_pnl || 0), 0);

    // Current open positions
    const openPositions = await base44.asServiceRole.entities.ArbLivePosition.filter(
      { status: 'Open' }, '-snapshot_time', 50,
    );

    const results = [];
    let tradeCounter = 1;

    for (const sig of candidates) {
      const gates = checkGates({ signal: sig, config, todayPnl, openPositions });

      if (!gates.allowed) {
        if (!dryRun) {
          await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
            status: 'rejected',
            rejection_reason: gates.reasons.join(','),
          });
        }
        results.push({
          signal_id: sig.id, pair: sig.pair, net_edge_bps: sig.net_edge_bps,
          decision: 'rejected', reasons: gates.reasons,
        });
        continue;
      }

      const sizeUsd = sizeTrade({ signal: sig, config });
      if (sizeUsd <= 0) {
        if (!dryRun) {
          await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
            status: 'rejected', rejection_reason: 'size_zero',
          });
        }
        results.push({ signal_id: sig.id, decision: 'rejected', reasons: ['size_zero'] });
        continue;
      }

      if (dryRun) {
        results.push({
          signal_id: sig.id, pair: sig.pair, net_edge_bps: sig.net_edge_bps,
          decision: 'would_execute', size_usd: sizeUsd,
        });
        continue;
      }

      // Execute
      let execResult, execError;
      try {
        execResult = await routeExecution({
          signal: sig, sizeUsd, paperTrading: config.paper_trading !== false,
        });
      } catch (e) {
        console.error('execution error', sig.id, e);
        execError = e.message;
      }

      if (execError) {
        await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
          status: 'rejected', rejection_reason: `exec_error:${execError}`,
        });
        results.push({ signal_id: sig.id, decision: 'error', error: execError });
        continue;
      }

      // Record ArbTrade
      const buyFill = execResult.fills.buy;
      const sellFill = execResult.fills.sell;
      const qty = buyFill?.qty || sellFill?.qty || 0;
      const grossSpread = (sellFill?.px || 0) - (buyFill?.px || 0);
      const notional = (buyFill?.notional_usd || 0);
      // Round-trip fees: entry (2 legs) + exit (2 legs) = 4 × taker fee
      const takerFee = Number(config.spot_taker_fee || 0);
      const entryFees = notional * takerFee * 2;     // spot entry + perp entry
      const exitFees = notional * takerFee * 2;      // spot exit + perp exit (modeled)
      const feeEst = entryFees + exitFees;           // total round-trip
      const basisPnl = qty * grossSpread;
      const netPnl = basisPnl - feeEst;

      // Map buy/sell venues (e.g. "OKX-perp", "Bybit-spot") → proper spot/perp slots + strategy.
      const buyVenueRaw = String(sig.buy_exchange || '');
      const sellVenueRaw = String(sig.sell_exchange || '');
      const buyIsSpot = /spot/i.test(buyVenueRaw);
      const buyIsPerp = /perp|swap|futures/i.test(buyVenueRaw);
      const sellIsSpot = /spot/i.test(sellVenueRaw);
      const sellIsPerp = /perp|swap|futures/i.test(sellVenueRaw);

      // Venue root ("OKX", "Bybit", "Binance"...) stripped of -spot / -perp suffix.
      const rootOf = (v) => v.replace(/-(spot|perp|swap|futures)$/i, '').trim();
      const buyRoot = rootOf(buyVenueRaw);
      const sellRoot = rootOf(sellVenueRaw);

      // Determine strategy and which leg is spot vs perp.
      let strategy;
      let spotExchange = buyRoot || sellRoot;
      let perpExchange = sellRoot || buyRoot;
      let spotEntryPx = buyFill?.px;
      let spotExitPx = sellFill?.px;
      let perpEntryPx = null;
      let perpExitPx = null;
      // Per-leg fee = notional × taker (quarter of total round-trip)
      const perLegFee = notional * takerFee;
      let spotEntryFee = perLegFee;
      let spotExitFee = perLegFee;
      let perpEntryFee = null;
      let perpExitFee = null;

      if ((buyIsSpot || buyIsPerp) && (sellIsSpot || sellIsPerp) && buyRoot === sellRoot) {
        // Same-venue spot↔perp basis carry
        strategy = 'Same-venue Spot/Perp Carry';
        spotExchange = buyRoot;
        perpExchange = buyRoot;
        if (buyIsSpot && sellIsPerp) {
          // Long spot / short perp (contango)
          spotEntryPx = buyFill?.px; perpEntryPx = sellFill?.px;
          spotEntryFee = perLegFee; perpEntryFee = perLegFee;
          spotExitFee = perLegFee;  perpExitFee = perLegFee;
          spotExitPx = null; perpExitPx = null;
        } else if (buyIsPerp && sellIsSpot) {
          // Long perp / short spot (backwardation)
          perpEntryPx = buyFill?.px; spotEntryPx = sellFill?.px;
          perpEntryFee = perLegFee; spotEntryFee = perLegFee;
          spotExitFee = perLegFee;  perpExitFee = perLegFee;
          spotExitPx = null; perpExitPx = null;
        }
      } else if (buyIsPerp && sellIsPerp) {
        strategy = 'Cross-venue Perp/Perp';
        perpExchange = `${buyRoot}/${sellRoot}`;
        spotExchange = null;
        perpEntryPx = buyFill?.px;
        perpExitPx = sellFill?.px;
        perpEntryFee = perLegFee;
        perpExitFee = perLegFee;
        spotEntryPx = null; spotExitPx = null; spotEntryFee = null; spotExitFee = null;
      } else {
        strategy = 'Cross-venue Spot Spread';
        spotExchange = `${buyRoot}/${sellRoot}`;
        perpExchange = null;
      }

      const tradeIdSuffix = `${Date.now().toString(36)}-${tradeCounter++}`;
      const directionLabel = strategy === 'Same-venue Spot/Perp Carry'
        ? (buyIsSpot
            ? `Long ${buyRoot} spot / Short ${buyRoot} perp`
            : `Long ${buyRoot} perp / Short ${buyRoot} spot`)
        : `Buy ${buyVenueRaw} / Sell ${sellVenueRaw}`;

      const trade = await base44.asServiceRole.entities.ArbTrade.create({
        trade_id: `AUTO-${tradeIdSuffix}`,
        trade_date: todayStr,
        entry_timestamp: new Date().toISOString(),
        exit_timestamp: new Date().toISOString(),
        status: 'Closed',
        strategy,
        asset: sig.asset || 'Other',
        spot_exchange: spotExchange,
        perp_exchange: perpExchange,
        direction: directionLabel,
        spot_entry_px: spotEntryPx,
        spot_exit_px: spotExitPx,
        perp_entry_px: perpEntryPx,
        perp_exit_px: perpExitPx,
        spot_qty: qty,
        perp_qty: perpEntryPx ? qty : null,
        gross_spread_entry: grossSpread,
        entry_spread_bps: Number(sig.raw_spread_bps || 0),
        exit_spread_bps: 0,
        spot_entry_fee: spotEntryFee,
        spot_exit_fee: spotExitFee,
        perp_entry_fee: perpEntryFee,
        perp_exit_fee: perpExitFee,
        total_realized_fees: feeEst,
        basis_pnl: basisPnl,
        net_pnl: netPnl,
        net_pnl_bps: notional > 0 ? (netPnl / notional) * 10000 : 0,
        allocated_capital: notional,
        entry_order_type: 'Market',
        exit_order_type: 'Market',
        entry_fee_type: 'Taker',
        exit_fee_type: 'Taker',
        entry_thesis: `Auto-executed from signal ${sig.id} (${Number(sig.net_edge_bps || 0).toFixed(2)} bps ${sig.notes || ''})`.trim(),
        mode: execResult.mode === 'paper' ? 'paper' : 'live',
      });

      await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
        status: 'executed',
        executed_pnl_bps: trade.net_pnl_bps,
        executed_pnl_usd: netPnl,
        win: netPnl > 0,
        notes: `trade=${trade.trade_id}`,
      });

      results.push({
        signal_id: sig.id, pair: sig.pair,
        decision: 'executed', mode: execResult.mode,
        trade_id: trade.trade_id, size_usd: Math.round(notional),
        net_pnl_usd: Number(netPnl.toFixed(2)),
      });
    }

    return Response.json({
      ok: true,
      dry_run: dryRun,
      paper_trading: config.paper_trading !== false,
      processed: results.length,
      executed: results.filter(r => r.decision === 'executed').length,
      rejected: results.filter(r => r.decision === 'rejected').length,
      results,
    });
  } catch (error) {
    console.error('executeSignals error:', error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});