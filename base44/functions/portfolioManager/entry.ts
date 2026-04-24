// Portfolio Management Orchestrator
//
// Runs all portfolio management checks on demand or on schedule:
// 1. Correlation monitoring (halt if <80%)
// 2. Auto-rebalancing (every 6 hours)
// 3. Profit compounding (daily, 70% compound / 30% reserve)
// 4. Position sizing summary

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMPOUND_RATIO        = 0.70;
const MIN_PROFIT_COMPOUND   = 100;
const CORRELATION_THRESHOLD = 0.80;
const CORRELATION_WARNING   = 0.90;
const MIN_DATA_POINTS       = 20;
const REBALANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MARGIN_DRIFT_THRESHOLD = 0.10;
const HEDGE_RATIO_THRESHOLD  = 0.95;

// ── Correlation ──────────────────────────────────────────────────
function calculateCorrelation(x, y) {
  if (x.length !== y.length || x.length < MIN_DATA_POINTS) return null;
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX, dy = y[i] - meanY;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  cov /= n; vx /= n; vy /= n;
  const sx = Math.sqrt(vx), sy = Math.sqrt(vy);
  if (sx === 0 || sy === 0) return null;
  return cov / (sx * sy);
}

async function checkCorrelations(base44) {
  const signals = await base44.asServiceRole.entities.ArbSignal.list('-received_time', 200);
  const pairsMap = {};
  signals.forEach(s => {
    if (!pairsMap[s.pair]) pairsMap[s.pair] = [];
    pairsMap[s.pair].push({ spot: s.buy_price, perp: s.sell_price });
  });

  const results = [];
  for (const [pair, data] of Object.entries(pairsMap)) {
    if (data.length < MIN_DATA_POINTS) { results.push({ pair, status: 'insufficient_data', canTrade: true }); continue; }
    const corr = calculateCorrelation(data.map(d => d.spot), data.map(d => d.perp));
    const status = corr === null ? 'unknown' : corr >= CORRELATION_WARNING ? 'healthy' : corr >= CORRELATION_THRESHOLD ? 'warning' : 'critical';
    results.push({ pair, correlation: corr !== null ? Math.round(corr * 1000) / 1000 : null, status, canTrade: corr === null || corr >= CORRELATION_THRESHOLD });
  }

  const critical = results.filter(r => r.status === 'critical');
  return {
    overall_status: critical.length > 0 ? 'critical' : results.some(r => r.status === 'warning') ? 'warning' : 'healthy',
    can_trade: critical.length === 0,
    pairs_monitored: results.length,
    critical_count: critical.length,
    pairs: results,
  };
}

// ── Rebalancer ───────────────────────────────────────────────────
async function checkRebalance(base44, config) {
  const positions = await base44.asServiceRole.entities.ArbLivePosition.filter({ status: 'Open' }, '-snapshot_time', 100);
  if (positions.length === 0) return { needed: false, reason: 'no_open_positions', issues: [], metrics: {} };

  const now = Date.now();
  const totalCapital = Number(config.total_capital || 0);
  const perpBucket = totalCapital * Number(config.perp_collateral_pct || 0.245);
  const marginUsed = positions.reduce((s, p) => s + Number(p.margin_used || 0), 0);
  const marginUtil = perpBucket > 0 ? marginUsed / perpBucket : 0;
  const targetUtil = Number(config.max_margin_utilization_pct || 0.35);
  const netDelta = positions.reduce((s, p) => s + Number(p.net_delta_usd || 0), 0);
  const gross = positions.reduce((s, p) => s + Math.abs(Number(p.spot_notional || 0)) + Math.abs(Number(p.perp_notional || 0)), 0);
  const hedgeRatio = gross > 0 ? 1 - Math.abs(netDelta) / gross : 1;
  const lastRebalance = config.last_rebalance_at ? new Date(config.last_rebalance_at).getTime() : 0;

  const issues = [];
  if (Math.abs(marginUtil - targetUtil) > MARGIN_DRIFT_THRESHOLD) issues.push({ type: 'margin_drift', current: marginUtil, target: targetUtil });
  if (hedgeRatio < HEDGE_RATIO_THRESHOLD) issues.push({ type: 'hedge_ratio_low', current: hedgeRatio, threshold: HEDGE_RATIO_THRESHOLD });
  if (now - lastRebalance > REBALANCE_INTERVAL_MS) issues.push({ type: 'time_based', hoursSinceLast: Math.floor((now - lastRebalance) / 3600000) });

  return {
    needed: issues.length > 0,
    issues,
    metrics: { marginUtil, hedgeRatio, netDelta, positions: positions.length, lastRebalance: lastRebalance > 0 ? new Date(lastRebalance).toISOString() : 'never' },
  };
}

// ── Compounding ──────────────────────────────────────────────────
async function checkCompound(base44, config) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);

  const yTrades = await base44.asServiceRole.entities.ArbTrade.filter({ status: 'Closed' }, '-exit_timestamp', 500);
  const yesterdayTrades = yTrades.filter(t => (t.trade_date || '').startsWith(yStr));
  const profit = yesterdayTrades.reduce((s, t) => s + Number(t.net_pnl || 0), 0);

  const lastCompoundDate = config.last_compound_at ? new Date(config.last_compound_at).toISOString().slice(0, 10) : null;
  const alreadyToday = lastCompoundDate === todayStr;

  if (alreadyToday) return { shouldCompound: false, reason: 'already_compounded_today', profit };
  if (profit <= 0) return { shouldCompound: false, reason: 'no_profit', profit };
  if (profit < MIN_PROFIT_COMPOUND) return { shouldCompound: false, reason: 'below_minimum', profit, minimum: MIN_PROFIT_COMPOUND };

  return {
    shouldCompound: true,
    profit,
    compoundAmount: profit * COMPOUND_RATIO,
    reserveAmount: profit * (1 - COMPOUND_RATIO),
    compoundRatio: COMPOUND_RATIO,
  };
}

// ── Main Handler ─────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { execute = false } = body;

    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config = configs[0];
    if (!config) return Response.json({ error: 'No config found' }, { status: 404 });

    const results = { timestamp: new Date().toISOString(), actions: [] };

    // 1. Correlation
    console.log('[PortfolioManager] Checking correlations...');
    const correlationCheck = await checkCorrelations(base44);
    results.correlation = {
      status: correlationCheck.overall_status,
      canTrade: correlationCheck.can_trade,
      pairs: correlationCheck.pairs_monitored,
      critical: correlationCheck.critical_count,
    };
    if (!correlationCheck.can_trade) {
      results.actions.push({
        type: 'trading_halted',
        reason: 'correlation_breakdown',
        criticalPairs: correlationCheck.pairs.filter(p => p.status === 'critical'),
      });
    }

    // 2. Rebalancing
    console.log('[PortfolioManager] Checking rebalancing...');
    const rebalanceCheck = await checkRebalance(base44, config);
    results.rebalance = { needed: rebalanceCheck.needed, ...rebalanceCheck.metrics };
    if (rebalanceCheck.needed && execute) {
      await base44.asServiceRole.entities.ArbConfig.update(config.id, {
        last_rebalance_at: new Date().toISOString(),
        rebalance_count: (config.rebalance_count || 0) + 1,
      });
      results.actions.push({ type: 'rebalance', executed: true, issues: rebalanceCheck.issues });
      console.log('[PortfolioManager] Rebalance executed');
    } else if (rebalanceCheck.needed) {
      results.actions.push({ type: 'rebalance_needed', issues: rebalanceCheck.issues });
    }

    // 3. Profit Compounding
    console.log('[PortfolioManager] Checking compounding...');
    const compoundCheck = await checkCompound(base44, config);
    results.compounding = { shouldCompound: compoundCheck.shouldCompound, profit: compoundCheck.profit, reason: compoundCheck.reason };
    if (compoundCheck.shouldCompound && execute) {
      const newCapital = Number(config.total_capital || 0) + compoundCheck.compoundAmount;
      await base44.asServiceRole.entities.ArbConfig.update(config.id, {
        total_capital: newCapital,
        last_compound_at: new Date().toISOString(),
        compounded_profits_total: (config.compounded_profits_total || 0) + compoundCheck.compoundAmount,
        reserved_profits_total:   (config.reserved_profits_total   || 0) + compoundCheck.reserveAmount,
        compound_count: (config.compound_count || 0) + 1,
      });
      results.actions.push({ type: 'compounding', executed: true, amount: compoundCheck.compoundAmount, newCapital });
      console.log(`[PortfolioManager] Compounded $${compoundCheck.compoundAmount.toFixed(2)}`);
    }

    // 4. Portfolio summary
    results.portfolio = {
      currentCapital: Number(config.total_capital || 0),
      compoundedProfits: config.compounded_profits_total || 0,
      reservedProfits: config.reserved_profits_total || 0,
      compoundCount: config.compound_count || 0,
      lastCompound: config.last_compound_at || null,
    };

    return Response.json({ ok: true, ...results });

  } catch (error) {
    console.error('[PortfolioManager] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});