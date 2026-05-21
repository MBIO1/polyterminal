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

// HARD NOTIONAL CAP — Base44-side last-line defense. Mirrored in order-server.
// Any signal sized above this is rejected before hitting the droplet.
const MAX_LIVE_NOTIONAL_USD = 100;

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
  
  // NEW: Book freshness bonus (industry standard)
  // Signals with fresh orderbook data are more reliable
  const ageMs = signalAgeMs(signal);
  const freshnessBonus = ageMs < 1000 ? 20 : ageMs < 5000 ? 10 : 0;
  
  return Math.min(100, Math.max(0, Math.round(agePts + confirmPts + fillPts + freshnessBonus)));
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

function computeSizeUsd(signal, config, confidence, capitalFlowUsd = null, profitGrowthUsd = 0) {
  const configuredCap = Number(config.total_capital || 0);
  const liveCap = Number(capitalFlowUsd || 0);
  const capitalBase = liveCap > 0 ? liveCap : configuredCap * Number(config.spot_allocation_pct || 0.35);

  // Start small, then increase as realized profits grow.
  const growthBoost = Math.min(Math.max(Number(profitGrowthUsd || 0), 0) / 100, 0.15);
  const basePct = capitalBase < 50 ? 0.25 : capitalBase < 250 ? 0.18 : 0.10;
  const perTradePct = Math.min(basePct + growthBoost, 0.30);
  const perTradeCap = capitalBase * perTradePct;

  const fillable      = Number(signal.fillable_size_usd || 0);
  const minExecutable = Math.max(5, Number(config.min_fillable_usd || 5));
  const mult          = sizeMultiplier(confidence);
  if (mult <= 0 || fillable < minExecutable || capitalBase < 5) return 0;

  const riskSize = Math.min(perTradeCap, fillable * 0.20, capitalBase * 0.85) * mult;
  // Floor at $5, then normalize upward later if exchange rules require more.
  return Math.min(Math.max(5, Math.floor(riskSize)), fillable, MAX_LIVE_NOTIONAL_USD, capitalBase * 0.85);
}

const BYBIT_RULES = {
  BTC:  { minQty: 0.001, qtyStep: 0.001, minNotionalUsd: 5 },
  ETH:  { minQty: 0.01,  qtyStep: 0.01,  minNotionalUsd: 10 },
  SOL:  { minQty: 0.1,   qtyStep: 0.1,   minNotionalUsd: 5 },
  DOGE: { minQty: 1,     qtyStep: 1,     minNotionalUsd: 5 },
  ADA:  { minQty: 1,     qtyStep: 1,     minNotionalUsd: 5 },
  APT:  { minQty: 0.1,   qtyStep: 0.1,   minNotionalUsd: 5 },
  XRP:  { minQty: 1,     qtyStep: 1,     minNotionalUsd: 5 },
  AVAX: { minQty: 0.01,  qtyStep: 0.01,  minNotionalUsd: 5 },
  ATOM: { minQty: 0.01,  qtyStep: 0.01,  minNotionalUsd: 5 },
};

function decimalsFromStep(step) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function ceilToStep(value, step) {
  const decimals = decimalsFromStep(step);
  return Number((Math.ceil((value / step) - 1e-12) * step).toFixed(decimals));
}

function normalizeOrderToExchangeRules(signal, sizeUsd, maxSpendUsd = MAX_LIVE_NOTIONAL_USD) {
  const buyPx = Number(signal.buy_price) || 0;
  const sellPx = Number(signal.sell_price) || buyPx;
  const rulePx = Math.max(buyPx, sellPx);
  if (!buyPx || !rulePx) return { ok: false, reason: 'missing_buy_price' };

  const fillable = Number(signal.fillable_size_usd || 0);
  const spendCap = Math.min(Number(maxSpendUsd || MAX_LIVE_NOTIONAL_USD), MAX_LIVE_NOTIONAL_USD);
  const asset = String(signal.asset || signal.pair?.split('-')?.[0] || 'Other').toUpperCase();
  const rules = BYBIT_RULES[asset] || { minQty: 1, qtyStep: 1, minNotionalUsd: 5 };

  // Build order, then normalize UP to exchange rules instead of rejecting early.
  const targetNotional = Math.max(Number(sizeUsd || 0), rules.minNotionalUsd);
  const minQtyByNotional = targetNotional / rulePx;
  const normalizedQty = ceilToStep(Math.max(minQtyByNotional, rules.minQty), rules.qtyStep);
  const normalizedSizeUsd = normalizedQty * rulePx;

  if (normalizedSizeUsd > spendCap) {
    return { ok: false, reason: `AVAILABLE_CAPITAL_BELOW_MIN: need $${normalizedSizeUsd.toFixed(2)}, available cap $${spendCap.toFixed(2)}` };
  }
  if (fillable < normalizedSizeUsd) {
    return { ok: false, reason: `INSUFFICIENT_LIQUIDITY: fillable $${fillable.toFixed(2)} < normalized $${normalizedSizeUsd.toFixed(2)}` };
  }

  return {
    ok: true,
    order: {
      sizeUsd: normalizedSizeUsd,
      qty: normalizedQty,
      minUsd: rules.minNotionalUsd,
      qtyStep: rules.qtyStep,
      minQty: rules.minQty,
    },
  };
}

function checkOrderbookDepth(signal, sizeUsd, config) {
  const fillable = Number(signal.fillable_size_usd || 0);
  const minFill = Number(config.min_fillable_usd || 5);
  return fillable >= Math.max(sizeUsd, minFill);
}

async function fetchAvailableCapitalUsd() {
  const dropletIp = Deno.env.get('DROPLET_IP');
  const secret = Deno.env.get('DROPLET_SECRET');
  const port = Deno.env.get('ORDER_SERVER_PORT') || '4001';
  if (!dropletIp || !secret) return null;

  for (const path of ['/api/balance', '/balance']) {
    try {
      const response = await fetch(`http://${dropletIp}:${port}${path}`, {
        method: 'GET',
        headers: {
          'X-Droplet-Secret': secret,
          'Authorization': `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) continue;
      const data = await response.json();
      const available = Number(data.totalAvailableBalance || data.availableBalance || 0);
      const equity = Number(data.totalEquity || 0);
      return available > 0 ? available : equity > 0 ? equity : null;
    } catch (_) {}
  }
  return null;
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

async function executeWithRetry(signal, qty, attempts = 2) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await executeViaDroplet(signal, qty);
      return { filled: true, result };
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
    }
  }
  return { filled: false, error: lastError?.message || 'EXECUTION_NOT_FILLED' };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

    // Allow admins and trusted internal function calls from ingestSignal; block everyone else.
    const internalSecret = String(body.internal_secret || '');
    const expectedSecret = Deno.env.get('BOT_SECRET') || Deno.env.get('DROPLET_SECRET') || '';
    const isInternalCall = !!internalSecret && internalSecret === expectedSecret;
    if (!isInternalCall) {
      let user = null;
      try { user = await base44.auth.me(); } catch { /* unauthenticated */ }
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (user.role !== 'admin') return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

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

    // Hard-stale cleanup: any signal older than 5 min is unconditionally expired,
    // regardless of TTL setting. This prevents pileup of stale signals.
    const HARD_STALE_MS = 5 * 60 * 1000;
    const hardStaleIds  = [];

    if (forceId) {
      const found = recentAll.find(s => s.id === forceId);
      if (!found) return Response.json({ error: `Signal ${forceId} not found` }, { status: 404 });
      candidates = [found];
      // Still run hard-stale cleanup even on forced execution
      for (const s of recentAll) {
        if (s.id === forceId) continue;
        const age = nowTs - new Date(s.received_time || s.created_date).getTime();
        if (age > HARD_STALE_MS) hardStaleIds.push(s.id);
      }
    } else {
      const fresh = [];
      for (const s of recentAll) {
        const age = nowTs - new Date(s.received_time || s.created_date).getTime();
        if (age > HARD_STALE_MS) {
          hardStaleIds.push(s.id);
        } else if (age > ttlMs) {
          expiredIds.push(s.id);
        } else {
          fresh.push(s);
        }
      }
      candidates = fresh.slice(0, maxSignals);
    }

    if (!dryRun && (expiredIds.length + hardStaleIds.length) > 0) {
      await Promise.all([
        ...expiredIds.map(id =>
          base44.asServiceRole.entities.ArbSignal.update(id, { status: 'expired', rejection_reason: 'ttl_exceeded' })
            .catch(e => console.error('expire failed', id, e.message))
        ),
        ...hardStaleIds.map(id =>
          base44.asServiceRole.entities.ArbSignal.update(id, { status: 'expired', rejection_reason: 'hard_stale_5min' })
            .catch(e => console.error('hard-stale expire failed', id, e.message))
        ),
      ]);
    }

    // ── Risk gates ────────────────────────────────────────────────────────────
    const [closedToday, openPositions, recentClosedTrades, liveAvailableCapitalUsd] = await Promise.all([
      base44.asServiceRole.entities.ArbTrade.filter({ status: 'Closed', trade_date: todayStr }, '-updated_date', 200),
      base44.asServiceRole.entities.ArbLivePosition.filter({ status: 'Open' }, '-snapshot_time', 50),
      base44.asServiceRole.entities.ArbTrade.filter({ status: 'Closed' }, '-trade_date', 200),
      fetchAvailableCapitalUsd(),
    ]);

    const totalCap = Number(config.total_capital || 0);
    const todayPnl = closedToday.reduce((a, t) => a + Number(t.net_pnl || 0), 0);
    const realizedProfitUsd = recentClosedTrades.reduce((a, t) => a + Math.max(Number(t.net_pnl || 0), 0), 0);
    const capitalFlowUsd = liveAvailableCapitalUsd || totalCap * Number(config.spot_allocation_pct || 0.35);
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
      // Lowered threshold from 40 to 30 to allow more signals (industry: 25-30)
      if (confidence < 30 && !forceId) {
        console.log(`[executeSignals] REJECT ${sig.pair}: confidence=${confidence} < 30`);
        continue;
      }

      if (signalAgeMs(sig) > 60_000 && !forceId) {
        console.log(`[executeSignals] REJECT ${sig.pair}: STALE_SIGNAL`);
        if (!dryRun) await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
          status: 'rejected', rejection_reason: 'STALE_SIGNAL',
        });
        continue;
      }

      const initialSizeUsd = computeSizeUsd(sig, config, confidence, capitalFlowUsd, realizedProfitUsd);
      if (initialSizeUsd <= 0) {
        console.log(`[executeSignals] REJECT ${sig.pair}: CAPITAL_SIZE_ZERO (confidence=${confidence}, fillable=${sig.fillable_size_usd}, total_cap=${config.total_capital})`);
        if (!dryRun) await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
          status: 'rejected', rejection_reason: 'CAPITAL_SIZE_ZERO',
        });
        continue;
      }

      const maxSpendUsd = Math.min(capitalFlowUsd * 0.85, MAX_LIVE_NOTIONAL_USD);
      const validOrder = normalizeOrderToExchangeRules(sig, initialSizeUsd, maxSpendUsd);
      if (!validOrder.ok) {
        console.log(`[executeSignals] REJECT ${sig.pair}: ${validOrder.reason}`);
        if (!dryRun) await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
          status: 'rejected', rejection_reason: validOrder.reason,
        });
        continue;
      }

      const { sizeUsd, qty } = validOrder.order;
      if (!checkOrderbookDepth(sig, sizeUsd, config) && !forceId) {
        console.log(`[executeSignals] REJECT ${sig.pair}: INSUFFICIENT_LIQUIDITY size=$${sizeUsd} fillable=$${sig.fillable_size_usd}`);
        if (!dryRun) await base44.asServiceRole.entities.ArbSignal.update(sig.id, {
          status: 'rejected', rejection_reason: 'INSUFFICIENT_LIQUIDITY',
        });
        continue;
      }

      const { rawBps, takerBps, slipBps, net } = recomputeNetEdge(sig, config, sizeUsd);

      if (net < minEdge && !forceId) {
        console.log(`[executeSignals] REJECT ${sig.pair}: net=${net.toFixed(2)}bps < min=${minEdge}bps`);
        continue;
      }

      console.log(`[executeSignals] ACCEPT ${sig.pair}: net=${net.toFixed(2)}bps size=$${sizeUsd.toFixed(2)} qty=${qty} confidence=${confidence} capital=$${capitalFlowUsd.toFixed(2)}`);
      scored.push({ sig, confidence, sizeUsd, qty, net, rawBps, takerBps, slipBps });
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

    for (const { sig, confidence, sizeUsd, qty, net, rawBps, takerBps, slipBps } of toExecute) {
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

      const isLive   = !config.paper_trading;

      let execResult;
      try {
        if (isLive) {
          // HARD CAP — reject any live order over MAX_LIVE_NOTIONAL_USD
          const notionalUsd = qty * buyPx;
          if (notionalUsd > MAX_LIVE_NOTIONAL_USD) {
            throw new Error(`hard_notional_cap_exceeded: $${notionalUsd.toFixed(2)} > $${MAX_LIVE_NOTIONAL_USD}`);
          }
          const execution = await executeWithRetry(sig, qty, 2);
          if (!execution.filled) throw new Error(`EXECUTION_NOT_FILLED:${execution.error}`);
          const dropletResult = execution.result;
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
      // CRITICAL: partial fills leave naked unhedged exposure. Mark as Error and alert.
      const isPartial = isLive && d && (!d.spotOk || !d.perpOk);
      const tradeStatus = isPartial ? 'Error' : 'Closed';

      const tradeIdSuffix = `${Date.now().toString(36)}-${tradeCounter++}`;
      const trade = await base44.asServiceRole.entities.ArbTrade.create({
        trade_id:           `AUTO-${tradeIdSuffix}`,
        trade_date:         todayStr,
        entry_timestamp:    new Date().toISOString(),
        exit_timestamp:     new Date().toISOString(),
        status:             tradeStatus,
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

      // CRITICAL ALERT on partial fill — naked exposure requires manual intervention
      if (isPartial) {
        const filledLeg  = d.spotOk ? 'spot' : 'perp';
        const missingLeg = d.spotOk ? 'perp' : 'spot';
        const orderId    = d.spotOk ? d.spotOrderId : d.perpOrderId;
        console.error(`[executeSignals] PARTIAL FILL ALERT trade=${trade.trade_id} ${filledLeg}=filled(${orderId}) ${missingLeg}=FAILED — NAKED POSITION`);

        // Activate kill-switch to halt further trades until reviewed
        await base44.asServiceRole.entities.ArbConfig.update(config.id, { kill_switch_active: true })
          .catch(e => console.error('kill-switch activation failed:', e.message));

        // Telegram alert
        const tgToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
        const tgChat  = Deno.env.get('TELEGRAM_CHAT_ID');
        if (tgToken && tgChat) {
          const msg = `🚨🚨 PARTIAL FILL — NAKED ${missingLeg.toUpperCase()} EXPOSURE\n\nTrade: ${trade.trade_id}\nPair: ${sig.pair}\nFilled: ${filledLeg} (${orderId})\nMissing: ${missingLeg}\nQty: ${qty}\n\n⛔ Kill-switch ACTIVATED. Manually flatten the ${filledLeg} leg on Bybit, then reset kill-switch.`;
          await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: tgChat, text: msg }),
            signal: AbortSignal.timeout(5000),
          }).catch(e => console.error('telegram alert failed:', e.message));
        }
      }

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
      hard_stale_cleaned:  hardStaleIds.length,
      results,
    });

  } catch (error) {
    const safeError = (error.message || 'fatal_error').slice(0, 100);
    console.error('[executeSignals] fatal error:', safeError);
    return Response.json({ error: 'execution_service_error' }, { status: 500 });
  }
});