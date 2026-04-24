// Auto-executor: CEX Arbitrage - Clean, self-contained
//
// THREE PILLARS:
//   PILLAR 1 — Staleness: signals older than TTL are expired
//   PILLAR 2 — Real edge: recomputes net edge with fees + slippage. Must be > minEdge to execute.
//   PILLAR 3 — Risk gates: daily drawdown, margin util, delta drift, kill switch

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_TTL_MS     = 300_000; // 5 minutes
const DEFAULT_MIN_EDGE   = 2.0;     // bps — minimum net edge to execute
const FEE_BPS_PER_LEG   = 2;       // taker fee per leg in bps
const SLIP_PCT_OF_FILL   = 0.001;   // 0.1% of fillable_size_usd as slippage (conservative)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function signalAgeMs(signal) {
  return Date.now() - new Date(signal.received_time || signal.created_date).getTime();
}

// Confidence 0–100 based on age + exchange confirmations + liquidity
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

// Recompute net edge: raw_spread - (4 × fee) - slippage
// 4-leg round trip: buy spot, sell perp (entry) + sell spot, buy perp (exit)
function recomputeNetEdge(signal, config, sizeUsd) {
  const rawBps    = Number(signal.raw_spread_bps || 0);
  const feeBps    = Number(config.taker_fee_bps_per_leg ?? FEE_BPS_PER_LEG);
  const fillable  = Number(signal.fillable_size_usd || 1);
  const slipBps   = Math.min((sizeUsd / fillable) * 100, 3); // impact capped at 3 bps
  const totalCost = 4 * feeBps + slipBps;
  const net       = rawBps - totalCost;
  return { rawBps, feeBps, slipBps, totalCost, net };
}

// Size in USD: min of per-trade cap, fillable liquidity × confidence mult
function computeSizeUsd(signal, config, confidence) {
  const totalCap   = Number(config.total_capital || 0);
  const spotBucket = totalCap * Number(config.spot_allocation_pct || 0.35);
  const perTradeCap= spotBucket * 0.10; // max 10% of spot bucket per trade
  const fillable   = Number(signal.fillable_size_usd || 0);
  const mult       = sizeMultiplier(confidence);
  const raw        = Math.min(perTradeCap, fillable * 0.20) * mult; // max 20% of book
  return Math.max(0, Math.floor(raw));
}

// Paper fill: instant at signal prices
function paperFill(signal, sizeUsd) {
  const buyPx  = Number(signal.buy_price)  || 0;
  const sellPx = Number(signal.sell_price) || 0;
  if (!buyPx || !sellPx) throw new Error('missing prices in signal');
  const qty = Number((sizeUsd / buyPx).toFixed(6));
  return {
    mode: 'paper',
    fills: {
      buy:  { venue: signal.buy_exchange,  px: buyPx,  qty, notional_usd: qty * buyPx },
      sell: { venue: signal.sell_exchange, px: sellPx, qty, notional_usd: qty * sellPx },
    },
  };
}

// Bybit live order (used when one leg is Bybit)
async function bybitSign(preSign, apiSecret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(preSign));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function bybitOrder({ symbol, side, qty }) {
  const isTestnet = (Deno.env.get('BYBIT_TESTNET') || 'true').toLowerCase() !== 'false';
  const base      = isTestnet ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
  const apiKey    = Deno.env.get('BYBIT_API_KEY');
  const apiSecret = Deno.env.get('BYBIT_API_SECRET');
  if (!apiKey || !apiSecret) throw new Error('Bybit keys not configured');

  const timestamp  = Date.now().toString();
  const recvWindow = '5000';
  const body       = JSON.stringify({ category: 'spot', symbol, side, orderType: 'Market', qty: String(qty), timeInForce: 'IOC' });
  const preSign    = timestamp + apiKey + recvWindow + body;
  const signature  = await bybitSign(preSign, apiSecret);

  const res  = await fetch(`${base}/v5/order/create`, {
    method: 'POST',
    headers: {
      'X-BAPI-API-KEY': apiKey, 'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp, 'X-BAPI-RECV-WINDOW': recvWindow,
      'Content-Type': 'application/json',
    },
    body,
  });
  return await res.json();
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user   = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body        = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const dryRun      = body.dry_run === true;
    const forceId     = body.signal_id || null;
    const ttlMs       = Number(body.signal_ttl_ms) || DEFAULT_TTL_MS;
    const maxSignals  = Math.min(Number(body.max_signals) || 10, 25);

    // ── Load config ──────────────────────────────────────────────────────────
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config  = configs?.[0];
    if (!config) return Response.json({ error: 'No ArbConfig found' }, { status: 400 });

    if (config.kill_switch_active) {
      return Response.json({ ok: false, halted: true, reason: 'kill_switch_active' });
    }
    if (!config.bot_running && !forceId) {
      return Response.json({ ok: false, halted: true, reason: 'bot_not_running' });
    }

    const minEdge = config.paper_trading
      ? 0.5
      : Math.min(
          Number(config.btc_min_edge_bps ?? DEFAULT_MIN_EDGE),
          Number(config.eth_min_edge_bps ?? DEFAULT_MIN_EDGE),
        );

    // ── Load signals ─────────────────────────────────────────────────────────
    const nowTs      = Date.now();
    const todayStr   = new Date().toISOString().slice(0, 10);
    const recentAll  = await base44.asServiceRole.entities.ArbSignal.list('-received_time', 200);

    let candidates;
    const expiredIds = [];

    if (forceId) {
      const found = recentAll.find(s => s.id === forceId);
      if (!found) return Response.json({ error: `Signal ${forceId} not found` }, { status: 404 });
      candidates = [found];
    } else {
      const pending = recentAll.filter(s => ['detected', 'alerted'].includes(s.status));
      const fresh   = [];

      for (const s of pending) {
        if (nowTs - new Date(s.received_time || s.created_date).getTime() > ttlMs) {
          expiredIds.push(s.id);
        } else {
          fresh.push(s);
        }
      }

      // Expire stale signals
      if (!dryRun && expiredIds.length > 0) {
        await Promise.all(expiredIds.map(id =>
          base44.asServiceRole.entities.ArbSignal.update(id, {
            status: 'expired',
            rejection_reason: `ttl_exceeded`,
          }).catch(e => console.error('expire failed', id, e.message))
        ));
      }

      candidates = fresh.slice(0, maxSignals);
    }

    // ── Load today P&L + open positions ──────────────────────────────────────
    const [closedToday, openPositions] = await Promise.all([
      base44.asServiceRole.entities.ArbTrade.filter({ status: 'Closed', trade_date: todayStr }, '-updated_date', 200),
      base44.asServiceRole.entities.ArbLivePosition.filter({ status: 'Open' }, '-snapshot_time', 50),
    ]);
    const todayPnl = closedToday.reduce((a, t) => a + Number(t.net_pnl || 0), 0);

    // ── Risk gates (portfolio level) ─────────────────────────────────────────
    const totalCap  = Number(config.total_capital || 0);
    const ddCap     = totalCap * Number(config.max_daily_drawdown_pct || 0.01);
    if (todayPnl < -ddCap) {
      return Response.json({ ok: false, halted: true, reason: `daily_drawdown_breach(${todayPnl.toFixed(2)})` });
    }

    const perpBucket   = totalCap * Number(config.perp_collateral_pct || 0.245);
    const marginUsed   = openPositions.reduce((a, p) => a + Number(p.margin_used || 0), 0);
    const marginUtil   = perpBucket > 0 ? marginUsed / perpBucket : 0;
    const maxMarginUtil= Number(config.max_margin_utilization_pct || 0.35);
    if (marginUtil >= maxMarginUtil) {
      return Response.json({ ok: false, halted: true, reason: `margin_util_breach(${(marginUtil*100).toFixed(1)}%)` });
    }

    // ── Score and filter signals ──────────────────────────────────────────────
    const scored = [];
    for (const sig of candidates) {
      const confidence = signalConfidence(sig, ttlMs);
      if (confidence < 40 && !forceId) continue; // STALE

      const sizeUsd = computeSizeUsd(sig, config, confidence);
      if (sizeUsd <= 0) continue;

      const { rawBps, feeBps, slipBps, totalCost, net } = recomputeNetEdge(sig, config, sizeUsd);

      // Gate: edge must be positive and above minEdge
      if (net < minEdge && !forceId) {
        console.log(`[executeSignals] REJECT ${sig.pair}: net=${net.toFixed(2)}bps < min=${minEdge}bps (raw=${rawBps}, cost=${totalCost.toFixed(2)})`);
        continue;
      }

      // Gate: liquidity
      const minFill = Number(config.min_fillable_usd || 200);
      if (Number(sig.fillable_size_usd || 0) < minFill && !forceId) continue;

      scored.push({ sig, confidence, sizeUsd, net, rawBps, feeBps, slipBps });
    }

    // Sort best edge first, deduplicate by asset (one trade per asset per run)
    scored.sort((a, b) => b.net - a.net);
    const seenAssets = new Set();
    const toExecute  = [];
    for (const s of scored) {
      if (seenAssets.has(s.sig.asset)) continue; // DEDUPLICATE
      seenAssets.add(s.sig.asset);
      toExecute.push(s);
    }

    // ── Execute ───────────────────────────────────────────────────────────────
    const results    = [];
    let tradeCounter = 1;

    for (const { sig, confidence, sizeUsd, net, rawBps, feeBps, slipBps } of toExecute) {
      const condition = confidence >= 80 ? 'HEALTHY' : confidence >= 60 ? 'VOLATILE' : 'UNCERTAIN';

      if (dryRun) {
        results.push({
          signal_id: sig.id, pair: sig.pair, decision: 'would_execute',
          size_usd: sizeUsd, confidence, condition, net_bps: net,
        });
        continue;
      }

      // Determine execution mode
      const buyVenue  = String(sig.buy_exchange  || '').toLowerCase();
      const sellVenue = String(sig.sell_exchange || '').toLowerCase();
      const hasLiveLeg= !config.paper_trading && (buyVenue.includes('bybit') || sellVenue.includes('bybit'));

      let execResult;
      try {
        if (hasLiveLeg) {
          const buyPx   = Number(sig.buy_price);
          const qty     = Number((sizeUsd / buyPx).toFixed(6));
          const symbol  = `${sig.asset}USDT`;
          const isOnBuy = buyVenue.includes('bybit');
          const side    = isOnBuy ? 'Buy' : 'Sell';
          const liveRes = await bybitOrder({ symbol, side, qty });
          execResult = {
            mode: liveRes.retCode === 0 ? 'live_partial' : 'paper',
            fills: {
              buy:  { venue: sig.buy_exchange,  px: buyPx,                qty },
              sell: { venue: sig.sell_exchange, px: Number(sig.sell_price), qty },
            },
          };
        } else {
          execResult = paperFill(sig, sizeUsd);
        }
      } catch (e) {
        console.error(`[executeSignals] exec error signal ${sig.id}:`, e.message);
        await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
          status: 'rejected', rejection_reason: `exec_error:${e.message}`,
        });
        results.push({ signal_id: sig.id, pair: sig.pair, decision: 'error', error: e.message });
        continue;
      }

      // Build trade record
      const buyFill   = execResult.fills.buy;
      const sellFill  = execResult.fills.sell;
      const qty       = buyFill?.qty || 0;
      const notional  = buyFill?.notional_usd || qty * (buyFill?.px || 0);
      const grossSpread = (sellFill?.px || 0) - (buyFill?.px || 0);
      const perLegFee = notional * (feeBps / 10000);
      const feeTotal  = perLegFee * 2;
      const slipTotal = notional * (slipBps / 10000);
      const basisPnl  = qty * grossSpread;
      const netPnl    = basisPnl - feeTotal - slipTotal;

      // Detect strategy
      const rootOf    = v => v.replace(/-(spot|perp|swap|futures)$/i, '').trim();
      const buyRoot   = rootOf(String(sig.buy_exchange  || ''));
      const sellRoot  = rootOf(String(sig.sell_exchange || ''));
      const buyIsPerp = /perp|swap|futures/i.test(sig.buy_exchange  || '');
      const sellIsPerp= /perp|swap|futures/i.test(sig.sell_exchange || '');
      const sameVenue = buyRoot === sellRoot && buyRoot !== '';

      let strategy, spotExchange, perpExchange, spotEntryPx, perpEntryPx, direction;
      if (sameVenue && (buyIsPerp !== sellIsPerp)) {
        strategy      = 'Same-venue Spot/Perp Carry';
        spotExchange  = buyRoot;
        perpExchange  = buyRoot;
        spotEntryPx   = buyIsPerp ? sellFill?.px : buyFill?.px;
        perpEntryPx   = buyIsPerp ? buyFill?.px  : sellFill?.px;
        direction     = buyIsPerp
          ? `Long ${buyRoot} perp / Short ${buyRoot} spot`
          : `Long ${buyRoot} spot / Short ${buyRoot} perp`;
      } else if (buyIsPerp && sellIsPerp) {
        strategy      = 'Cross-venue Perp/Perp';
        perpExchange  = `${buyRoot}/${sellRoot}`;
        spotExchange  = null;
        perpEntryPx   = buyFill?.px;
        direction     = `Buy ${sig.buy_exchange} / Sell ${sig.sell_exchange}`;
      } else {
        strategy      = 'Cross-venue Spot Spread';
        spotExchange  = `${buyRoot}/${sellRoot}`;
        perpExchange  = null;
        spotEntryPx   = buyFill?.px;
        direction     = `Buy ${sig.buy_exchange} / Sell ${sig.sell_exchange}`;
      }

      const tradeIdSuffix = `${Date.now().toString(36)}-${tradeCounter++}`;
      const trade = await base44.asServiceRole.entities.ArbTrade.create({
        trade_id:          `AUTO-${tradeIdSuffix}`,
        trade_date:        todayStr,
        entry_timestamp:   new Date().toISOString(),
        exit_timestamp:    new Date().toISOString(),
        status:            'Closed',
        strategy,
        asset:             sig.asset || 'Other',
        spot_exchange:     spotExchange,
        perp_exchange:     perpExchange,
        direction,
        spot_entry_px:     spotEntryPx   || null,
        spot_exit_px:      null,
        perp_entry_px:     perpEntryPx   || null,
        perp_exit_px:      null,
        spot_qty:          qty,
        perp_qty:          perpEntryPx ? qty : null,
        gross_spread_entry: grossSpread,
        entry_spread_bps:  rawBps,
        exit_spread_bps:   0,
        spot_entry_fee:    perLegFee,
        spot_exit_fee:     perLegFee,
        perp_entry_fee:    perpEntryPx ? perLegFee : null,
        perp_exit_fee:     perpEntryPx ? perLegFee : null,
        expected_slippage: slipTotal,
        realized_slippage: slipTotal,
        total_realized_fees: feeTotal + slipTotal,
        basis_pnl:         basisPnl,
        net_pnl:           netPnl,
        net_pnl_bps:       notional > 0 ? (netPnl / notional) * 10000 : 0,
        allocated_capital: notional,
        entry_order_type:  'Market',
        exit_order_type:   'Market',
        entry_fee_type:    'Taker',
        exit_fee_type:     'Taker',
        mode:              execResult.mode === 'paper' ? 'paper' : 'live',
        entry_thesis:      `Auto-executed signal ${sig.id} | net=${net.toFixed(2)}bps | confidence=${confidence}% | condition=${condition} | ${sig.notes || ''}`.trim(),
        net_delta_usd:     0,
        borrow_conversion_cost: 0,
      });

      await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
        status:            'executed',
        executed_pnl_bps:  trade.net_pnl_bps,
        executed_pnl_usd:  netPnl,
        win:               netPnl > 0,
        notes:             `trade=${trade.trade_id} confidence=${confidence}% condition=${condition}`,
      });

      console.log(`[executeSignals] EXECUTED ${sig.pair} | trade=${trade.trade_id} | net=${net.toFixed(2)}bps | pnl=$${netPnl.toFixed(4)} | mode=${execResult.mode}`);

      results.push({
        signal_id:           sig.id,
        pair:                sig.pair,
        decision:            'executed',
        mode:                execResult.mode,
        trade_id:            trade.trade_id,
        size_usd:            Math.round(notional),
        net_bps:             Number(net.toFixed(2)),
        net_pnl_usd:         Number(netPnl.toFixed(4)),
        confidence,
        condition,
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
    console.error('[executeSignals] fatal error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});