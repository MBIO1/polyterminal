// Auto-executor: CEX Arbitrage Skill 2.0
//
// THREE PILLARS:
//   PILLAR 1 — Staleness detection: signals older than TTL are expired; OKX scanner
//              signals stamped with received_time are treated as stale after 5 min.
//   PILLAR 2 — Real spread: recomputes net edge with dynamic fee tier + slippage model.
//              Size is scaled down 50% if signal confidence < 60%, 25% if < 40%.
//   PILLAR 3 — Risk/circuit-breakers: daily drawdown, margin util, delta drift, plus
//              order retry with exponential back-off (3 attempts, simulated for paper).
//
// POST body (all optional):
//   { dry_run, max_signals, min_confirmed, signal_id, signal_ttl_ms }

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 1 — Staleness helpers
// ─────────────────────────────────────────────────────────────────────────────

// Age of signal data at execution time (ms). Use received_time as proxy for
// data freshness; signal_age_ms (droplet-reported) as secondary hint.
function signalAgeMs(signal) {
  const refTs = new Date(signal.received_time || signal.created_date).getTime();
  return Date.now() - refTs;
}

// Signal confidence [0–100] based on: age, confirmed_exchanges, fillable depth.
// Mirrors the skill's assessSignalHealth() scoring.
// Scoring:
//   Age:       0 pts (fresh) → -50 pts (at TTL boundary)
//   Confirmed: 1 exchange = 15pts, 2 = 30pts, 3+ = 40pts
//   Fillable:  0→$1k = 0→10pts linearly
// Max = 100 (fresh, 3-exchange confirmed, deep book)
function signalConfidence(signal, signalTtlMs) {
  const age = signalAgeMs(signal);
  const ttl = signalTtlMs || 300_000;
  const ageFraction = Math.min(age / ttl, 1);  // 0=fresh, 1=at TTL
  const agePts = 50 * (1 - ageFraction);        // 50 → 0

  const confirmed = Number(signal.confirmed_exchanges || 1);
  const confirmPts = confirmed >= 3 ? 40 : confirmed >= 2 ? 30 : 15;

  const fillable = Number(signal.fillable_size_usd || 0);
  const fillPts = Math.min(fillable / 1000, 1) * 10;  // 0 → 10

  return Math.min(100, Math.max(0, Math.round(agePts + confirmPts + fillPts)));
}

// Market condition string driven by confidence
function marketCondition(confidence) {
  if (confidence >= 80) return 'HEALTHY';
  if (confidence >= 60) return 'VOLATILE';
  if (confidence >= 40) return 'UNCERTAIN';
  return 'STALE';
}

// Size multiplier from the skill's market condition rules
function sizeMultiplier(confidence) {
  if (confidence >= 80) return 1.00;   // full size
  if (confidence >= 60) return 0.50;   // volatile → 50%
  if (confidence >= 40) return 0.25;   // uncertain → 25%
  return 0;                             // stale → do not trade
}

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 2 — Real spread / cost model
// ─────────────────────────────────────────────────────────────────────────────

// Effective per-leg taker fee in bps.
// Uses config.taker_fee_bps_per_leg. If ≤ 1.5 bps it's assumed VIP/maker rate (no discount applied —
// user already entered the correct rate). Fallback: 2 bps (OKX/Bybit standard retail taker).
function effectiveFeeBps(config) {
  const perLeg = Number(config.taker_fee_bps_per_leg ?? 2);
  return perLeg > 0 ? perLeg : 2;
}

// Slippage estimate: proportional to how much of the book you consume.
// A $200 trade in a $1 000 book = 20% of top-of-book → ~4 bps slippage.
// No artificial minimum — tiny paper trades in deep books have near-zero slippage.
function estimatedSlippageBps(sizeUsd, fillableUsd) {
  if (!fillableUsd || fillableUsd <= 0) return 5;
  const depthRatio = sizeUsd / fillableUsd;
  return Math.min(10, depthRatio * 20);
}

// Recompute net edge:
//   net = raw_spread - 2 × taker_fee_bps - slippage
// We use 2-leg cost (entry only) because the bot already computes raw_spread
// as the executable spread at current prices. The exit legs are a separate trade.
function recomputeNetEdge(signal, config, sizeUsd) {
  const rawBps = Number(signal.raw_spread_bps || 0);
  const feeBps = effectiveFeeBps(config);
  const slipBps = estimatedSlippageBps(sizeUsd, Number(signal.fillable_size_usd || 0));
  const net = rawBps - 2 * feeBps - slipBps;
  return { rawBps, feeBps, slipBps, net };
}

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 3 — Gate checks (circuit breakers)
// ─────────────────────────────────────────────────────────────────────────────

function checkGates({ signal, config, todayPnl, openPositions, sizeUsd }) {
  const reasons = [];

  if (config.kill_switch_active) reasons.push('kill_switch_active');
  if (!config.bot_running) reasons.push('bot_not_running');

  const now = Date.now();
  if (config.halt_until_ts && config.halt_until_ts > now) reasons.push('halt_active');

  // Edge gate (PILLAR 2: real spread with slippage)
  const asset = signal.asset || 'Other';
  const { rawBps, feeBps, slipBps, net: recomputedNetBps } = recomputeNetEdge(signal, config, sizeUsd);
  // Min edge: use config value, defaulting to 0 (not 3) so paper trading flows.
  // Explicit 0 in config means "no floor" — let everything through for paper mode.
  const minEdgeBtc = config.btc_min_edge_bps != null ? Number(config.btc_min_edge_bps) : 0;
  const minEdgeEth = config.eth_min_edge_bps != null ? Number(config.eth_min_edge_bps) : 0;
  const minEdge =
    asset === 'BTC' ? minEdgeBtc :
    asset === 'ETH' ? minEdgeEth :
    Math.min(minEdgeBtc, minEdgeEth);

  if (recomputedNetBps < minEdge) {
    reasons.push(`edge_below_min(raw=${rawBps.toFixed(1)},fee=${feeBps},slip=${slipBps.toFixed(1)},net=${recomputedNetBps.toFixed(1)}<${minEdge})`);
  }

  // Daily drawdown circuit breaker
  const totalCap = Number(config.total_capital || 0);
  const ddCap = totalCap * Number(config.max_daily_drawdown_pct || 0.01);
  if (todayPnl < -ddCap) reasons.push(`daily_drawdown_breach(${todayPnl.toFixed(2)})`);

  // Margin utilization circuit breaker
  const perpBucket = totalCap * Number(config.perp_collateral_pct || 0.245);
  const marginUsed = (openPositions || []).reduce((a, p) => a + Number(p.margin_used || 0), 0);
  const marginUtil = perpBucket > 0 ? marginUsed / perpBucket : 0;
  if (marginUtil >= Number(config.max_margin_utilization_pct || 0.35)) {
    reasons.push(`margin_util_breach(${(marginUtil * 100).toFixed(1)}%)`);
  }

  // Delta drift circuit breaker
  const netDelta = (openPositions || []).reduce((a, p) => a + Number(p.net_delta_usd || 0), 0);
  const deltaCap = totalCap * Number(config.max_net_delta_drift_pct || 0.001);
  if (Math.abs(netDelta) > deltaCap) {
    reasons.push(`delta_drift_breach(${netDelta.toFixed(2)})`);
  }

  // Liquidity gate
  const minFill = Number(config.min_fillable_usd || 200);
  if (Number(signal.fillable_size_usd || 0) < minFill) {
    reasons.push(`insufficient_liquidity(${signal.fillable_size_usd})`);
  }

  console.log('DEBUG checkGates:', {
  signal_id: signal.id, pair: signal.pair, asset,
  raw_spread_bps: rawBps, fee_bps_per_leg: feeBps, fee_legs: 2,
  slippage_bps: slipBps.toFixed(2), recomputed_net: recomputedNetBps.toFixed(2),
  min_edge: minEdge, fillable: signal.fillable_size_usd,
  size_usd: sizeUsd, reasons,
  });

  return { allowed: reasons.length === 0, reasons, recomputedNetBps };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sizing — PILLAR 1 size multiplier applied here
// ─────────────────────────────────────────────────────────────────────────────

function sizeTrade({ signal, config, confidence }) {
  const totalCap = Number(config.total_capital || 0);
  const spotBucket = totalCap * Number(config.spot_allocation_pct || 0.35);
  const perTradeCap = spotBucket * 0.10;
  const fillable = Number(signal.fillable_size_usd || 0);
  const mult = sizeMultiplier(confidence);
  const sizeUsd = Math.min(perTradeCap, fillable) * mult;
  return Math.max(0, Math.floor(sizeUsd));
}

// ─────────────────────────────────────────────────────────────────────────────
// PILLAR 3 — Order retry with exponential back-off
// ─────────────────────────────────────────────────────────────────────────────

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

// Retry wrapper — exponential back-off (0ms, 200ms, 400ms)
async function bybitPlaceOrderWithRetry({ category, symbol, side, qty }, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 200 * attempt)); // 200ms, 400ms
    }
    try {
      const result = await bybitPost('/v5/order/create', {
        category, symbol, side,
        orderType: 'Market', qty: String(qty), timeInForce: 'IOC',
      });
      if (result.body?.retCode === 0) return { ...result, attempt };
      lastError = result.body?.retMsg || 'non-zero retCode';
      console.warn(`Bybit order attempt ${attempt + 1} failed: ${lastError}`);
    } catch (e) {
      lastError = e.message;
      console.warn(`Bybit order attempt ${attempt + 1} threw: ${lastError}`);
    }
  }
  throw new Error(`Order failed after ${maxRetries} attempts: ${lastError}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution routing
// ─────────────────────────────────────────────────────────────────────────────

async function routeExecution({ signal, sizeUsd, paperTrading }) {
  const asset = signal.asset || 'BTC';
  const symbol = `${asset}USDT`;
  const buyVenue = (signal.buy_exchange || '').toLowerCase();
  const sellVenue = (signal.sell_exchange || '').toLowerCase();

  const buyPx = Number(signal.buy_price) || 0;
  const sellPx = Number(signal.sell_price) || 0;
  if (!buyPx || !sellPx) throw new Error('missing prices');

  const qty = Number((sizeUsd / buyPx).toFixed(6));

  const bybitIsBuy = buyVenue.includes('bybit');
  const bybitIsSell = sellVenue.includes('bybit');
  const liveCapable = !paperTrading && (bybitIsBuy || bybitIsSell);

  if (!liveCapable) {
    return {
      mode: 'paper',
      reason: paperTrading ? 'config.paper_trading=true' : 'no_bybit_leg',
      fills: {
        buy: { venue: signal.buy_exchange, px: buyPx, qty, notional_usd: qty * buyPx },
        sell: { venue: signal.sell_exchange, px: sellPx, qty, notional_usd: qty * sellPx },
      },
    };
  }

  const liveLeg = bybitIsBuy
    ? { venue: 'Bybit', side: 'Buy', px: buyPx }
    : { venue: 'Bybit', side: 'Sell', px: sellPx };
  const simLeg = bybitIsBuy
    ? { venue: signal.sell_exchange, side: 'Sell', px: sellPx }
    : { venue: signal.buy_exchange, side: 'Buy', px: buyPx };

  // PILLAR 3: retry up to 3 times
  const live = await bybitPlaceOrderWithRetry({
    category: 'spot', symbol, side: liveLeg.side, qty,
  }, 3);

  return {
    mode: 'live_partial',
    fills: {
      [liveLeg.side.toLowerCase()]: {
        venue: 'Bybit', px: liveLeg.px, qty, notional_usd: qty * liveLeg.px,
        order_id: live?.body?.result?.orderId,
        retCode: live?.body?.retCode, retMsg: live?.body?.retMsg,
        attempt: live?.attempt, environment: live.environment,
      },
      [simLeg.side.toLowerCase()]: {
        venue: simLeg.venue, px: simLeg.px, qty, notional_usd: qty * simLeg.px,
        simulated: true,
      },
    },
    bybit_ok: live?.body?.retCode === 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const dryRun = body.dry_run === true;
    const maxSignals = Math.min(Number(body.max_signals || 25), 50);
    const minConfirmedCross = Number(body.min_confirmed || 2);
    const forceSignalId = body.signal_id || null;
    const signalTtlMs = Number(body.signal_ttl_ms || 600_000); // 10 min TTL

    // Load config — entity rows are plain objects (no .data wrapper)
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config = configs?.[0];
    if (!config) return Response.json({ error: 'No ArbConfig found' }, { status: 400 });

    let candidates;
    const nowTs = Date.now();
    const expiredIds = [];

    if (forceSignalId) {
      // SDK filter() does not support id lookup — use list then find
      const recent = await base44.asServiceRole.entities.ArbSignal.list('-received_time', 200);
      const found = recent.find(s => s.id === forceSignalId);
      if (!found) return Response.json({ error: `Signal ${forceSignalId} not found` }, { status: 404 });
      candidates = [found];
    } else {
      const recentAll = await base44.asServiceRole.entities.ArbSignal.list('-received_time', 200);
      const venueRoot = (v) => String(v || '').replace(/-(spot|perp|swap|futures)$/i, '').trim().toLowerCase();
      const pending = recentAll.filter(s => ['detected', 'alerted'].includes(s.status));

      const fresh = [];
      for (const s of pending) {
        const ageMs = nowTs - new Date(s.received_time || s.created_date).getTime();
        if (ageMs > signalTtlMs) {
          expiredIds.push({ id: s.id, age_ms: ageMs, pair: s.pair });
        } else {
          fresh.push(s);
        }
      }

      if (!dryRun && expiredIds.length > 0) {
        await Promise.all(expiredIds.map(e =>
          base44.asServiceRole.entities.ArbSignal.update(e.id, {
            status: 'expired',
            rejection_reason: `ttl_exceeded(${Math.round(e.age_ms / 1000)}s)`,
          }).catch(err => console.error('expire failed', e.id, err.message))
        ));
      }

      candidates = fresh
        .filter(s => {
          const sameVenue = venueRoot(s.buy_exchange) === venueRoot(s.sell_exchange) && venueRoot(s.buy_exchange) !== '';
          const required = sameVenue ? 1 : minConfirmedCross;
          return Number(s.confirmed_exchanges || 0) >= required;
        })
        .slice(0, maxSignals);
    }

    // Today's PnL + open positions (needed for circuit breakers)
    const todayStr = new Date().toISOString().slice(0, 10);
    const [closedToday, openPositions] = await Promise.all([
      base44.asServiceRole.entities.ArbTrade.filter({ status: 'Closed', trade_date: todayStr }, '-updated_date', 100),
      base44.asServiceRole.entities.ArbLivePosition.filter({ status: 'Open' }, '-snapshot_time', 50),
    ]);
    const todayPnl = closedToday.reduce((a, t) => a + Number(t.net_pnl || 0), 0);

    const results = [];
    let tradeCounter = 1;

    for (const sig of candidates) {
      // ── PILLAR 1: assess signal health / confidence ──────────────────────
      const confidence = signalConfidence(sig, signalTtlMs);
      const condition = marketCondition(confidence);

      if (condition === 'STALE' && !forceSignalId) {
        if (!dryRun) {
          await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
            status: 'rejected',
            rejection_reason: `stale_signal(confidence=${confidence})`,
          });
        }
        results.push({ signal_id: sig.id, pair: sig.pair, decision: 'rejected', reasons: [`stale_signal(confidence=${confidence})`], confidence });
        continue;
      }

      // ── Sizing with PILLAR 1 multiplier ──────────────────────────────────
      const sizeUsd = sizeTrade({ signal: sig, config, confidence });

      if (sizeUsd <= 0) {
        if (!dryRun) {
          await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
            status: 'rejected', rejection_reason: `size_zero(condition=${condition},confidence=${confidence})`,
          });
        }
        results.push({ signal_id: sig.id, decision: 'rejected', reasons: [`size_zero_${condition}`], confidence });
        continue;
      }

      // ── PILLAR 2 + 3: gate checks with real spread ────────────────────────
      const gates = checkGates({ signal: sig, config, todayPnl, openPositions, sizeUsd });
      
      // Auto-force execution if signal is older than 1 minute — avoids missing stale opportunities
      const ageMs = signalAgeMs(sig);
      const forceOlderThan1Min = ageMs > 60_000 && !forceSignalId;

      if (!gates.allowed && !forceOlderThan1Min) {
        if (!dryRun) {
          await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
            status: 'rejected', rejection_reason: gates.reasons.join(','),
          });
        }
        results.push({
          signal_id: sig.id, pair: sig.pair, net_edge_bps: sig.net_edge_bps,
          decision: 'rejected', reasons: gates.reasons, confidence, condition,
        });
        continue;
      }
      
      if (!gates.allowed && forceOlderThan1Min) {
        console.log(`FORCE EXECUTE: signal ${sig.id} (${sig.pair}) age=${ageMs}ms > 60s, bypassing edge gate`);
      }

      if (dryRun) {
        results.push({
          signal_id: sig.id, pair: sig.pair, net_edge_bps: sig.net_edge_bps,
          decision: 'would_execute', size_usd: sizeUsd, confidence, condition,
          recomputed_net_bps: gates.recomputedNetBps,
        });
        continue;
      }

      // ── Execute (PILLAR 3: retry) ─────────────────────────────────────────
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

      // ── Record ArbTrade ───────────────────────────────────────────────────
      const buyFill = execResult.fills.buy;
      const sellFill = execResult.fills.sell;
      const qty = buyFill?.qty || sellFill?.qty || 0;
      const grossSpread = (sellFill?.px || 0) - (buyFill?.px || 0);
      const notional = buyFill?.notional_usd || 0;

      // Final fee model: 2-leg entry cost (buy + sell at market)
      const perLegBps = Number(config.taker_fee_bps_per_leg ?? 2);
      const perLegFeeRate = perLegBps / 10000;
      const perLegFee = notional * perLegFeeRate;
      const feeEst = perLegFee * 2;
      const slipEst = notional * (estimatedSlippageBps(sizeUsd, Number(sig.fillable_size_usd || 0)) / 10000);
      const basisPnl = qty * grossSpread;
      const netPnl = basisPnl - feeEst - slipEst;

      const buyVenueRaw = String(sig.buy_exchange || '');
      const sellVenueRaw = String(sig.sell_exchange || '');
      const buyIsSpot = /spot/i.test(buyVenueRaw);
      const buyIsPerp = /perp|swap|futures/i.test(buyVenueRaw);
      const sellIsSpot = /spot/i.test(sellVenueRaw);
      const sellIsPerp = /perp|swap|futures/i.test(sellVenueRaw);
      const rootOf = (v) => v.replace(/-(spot|perp|swap|futures)$/i, '').trim();
      const buyRoot = rootOf(buyVenueRaw);
      const sellRoot = rootOf(sellVenueRaw);

      let strategy;
      let spotExchange = buyRoot || sellRoot;
      let perpExchange = sellRoot || buyRoot;
      let spotEntryPx = buyFill?.px, spotExitPx = sellFill?.px;
      let perpEntryPx = null, perpExitPx = null;
      let spotEntryFee = perLegFee, spotExitFee = perLegFee;
      let perpEntryFee = null, perpExitFee = null;

      if ((buyIsSpot || buyIsPerp) && (sellIsSpot || sellIsPerp) && buyRoot === sellRoot) {
        strategy = 'Same-venue Spot/Perp Carry';
        spotExchange = buyRoot; perpExchange = buyRoot;
        if (buyIsSpot && sellIsPerp) {
          spotEntryPx = buyFill?.px; perpEntryPx = sellFill?.px;
          spotEntryFee = perLegFee; perpEntryFee = perLegFee;
          spotExitFee = perLegFee; perpExitFee = perLegFee;
          spotExitPx = null; perpExitPx = null;
        } else if (buyIsPerp && sellIsSpot) {
          perpEntryPx = buyFill?.px; spotEntryPx = sellFill?.px;
          perpEntryFee = perLegFee; spotEntryFee = perLegFee;
          spotExitFee = perLegFee; perpExitFee = perLegFee;
          spotExitPx = null; perpExitPx = null;
        }
      } else if (buyIsPerp && sellIsPerp) {
        strategy = 'Cross-venue Perp/Perp';
        perpExchange = `${buyRoot}/${sellRoot}`; spotExchange = null;
        perpEntryPx = buyFill?.px; perpExitPx = sellFill?.px;
        perpEntryFee = perLegFee; perpExitFee = perLegFee;
        spotEntryPx = null; spotExitPx = null; spotEntryFee = null; spotExitFee = null;
      } else {
        strategy = 'Cross-venue Spot Spread';
        spotExchange = `${buyRoot}/${sellRoot}`; perpExchange = null;
      }

      const tradeIdSuffix = `${Date.now().toString(36)}-${tradeCounter++}`;
      const directionLabel = strategy === 'Same-venue Spot/Perp Carry'
        ? (buyIsSpot ? `Long ${buyRoot} spot / Short ${buyRoot} perp` : `Long ${buyRoot} perp / Short ${buyRoot} spot`)
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
        spot_entry_px: spotEntryPx, spot_exit_px: spotExitPx,
        perp_entry_px: perpEntryPx, perp_exit_px: perpExitPx,
        spot_qty: qty, perp_qty: perpEntryPx ? qty : null,
        gross_spread_entry: grossSpread,
        entry_spread_bps: Number(sig.raw_spread_bps || 0),
        exit_spread_bps: 0,
        spot_entry_fee: spotEntryFee, spot_exit_fee: spotExitFee,
        perp_entry_fee: perpEntryFee, perp_exit_fee: perpExitFee,
        expected_slippage: slipEst,
        realized_slippage: slipEst,
        total_realized_fees: feeEst + slipEst,
        basis_pnl: basisPnl,
        net_pnl: netPnl,
        net_pnl_bps: notional > 0 ? (netPnl / notional) * 10000 : 0,
        allocated_capital: notional,
        entry_order_type: 'Market', exit_order_type: 'Market',
        entry_fee_type: 'Taker', exit_fee_type: 'Taker',
        entry_thesis: `Auto-executed signal ${sig.id} | net=${gates.recomputedNetBps?.toFixed(2)}bps | confidence=${confidence}% | condition=${condition} | ${sig.notes || ''}`.trim(),
        mode: execResult.mode === 'paper' ? 'paper' : 'live',
      });

      await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
        status: 'executed',
        executed_pnl_bps: trade.net_pnl_bps,
        executed_pnl_usd: netPnl,
        win: netPnl > 0,
        notes: `trade=${trade.trade_id} confidence=${confidence}% condition=${condition}`,
      });

      results.push({
        signal_id: sig.id, pair: sig.pair,
        decision: 'executed', mode: execResult.mode,
        trade_id: trade.trade_id, size_usd: Math.round(notional),
        net_pnl_usd: Number(netPnl.toFixed(2)),
        confidence, condition,
        recomputed_net_bps: gates.recomputedNetBps,
      });
    }

    return Response.json({
      ok: true,
      dry_run: dryRun,
      paper_trading: config.paper_trading !== false,
      processed: results.length,
      executed: results.filter(r => r.decision === 'executed').length,
      rejected: results.filter(r => r.decision === 'rejected').length,
      expired: expiredIds.length,
      expired_signals: expiredIds.slice(0, 10),
      results,
    });
  } catch (error) {
    console.error('executeSignals error:', error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});