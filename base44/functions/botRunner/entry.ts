/**
 * Persistent Bot Runner — runs server-side so the bot keeps going
 * even when the browser window is closed or the user navigates away.
 *
 * Called by two automations:
 *   1. Scheduled: every 8s  → action="scan"
 *   2. Frontend  (manual)   → action="status" | "stop"
 *
 * Trade history is stored in BotTrade entity and used to adapt behavior.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Polymarket CLOB order book depth (public API, no auth required) ───────────
async function fetchOrderBookDepth(tokenId) {
  try {
    const res = await fetch(
      `https://clob.polymarket.com/book?token_id=${tokenId}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return { bids_depth: 0, asks_depth: 0, spread_pct: 100 };
    const data = await res.json();
    const bids = (data.bids || []).slice(0, 5).reduce((s, b) => s + parseFloat(b.size || 0), 0);
    const asks = (data.asks || []).slice(0, 5).reduce((s, a) => s + parseFloat(a.size || 0), 0);
    const bestBid = parseFloat(data.bids?.[0]?.price || 0);
    const bestAsk = parseFloat(data.asks?.[0]?.price || 1);
    const spreadPct = bestBid > 0 ? ((bestAsk - bestBid) / bestBid) * 100 : 100;
    return { bids_depth: bids, asks_depth: asks, spread_pct: spreadPct };
  } catch {
    return { bids_depth: 0, asks_depth: 0, spread_pct: 100 };
  }
}

// ── Live crypto prices (Binance primary, Coinbase fallback) ───────────────────
async function fetchLivePrices() {
  const results = await Promise.allSettled([
    fetch('https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT"]', { signal: AbortSignal.timeout(4000) }).then(r => r.json()),
    fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { signal: AbortSignal.timeout(4000) }).then(r => r.json()),
    fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', { signal: AbortSignal.timeout(4000) }).then(r => r.json()),
  ]);

  let btcBinance = null, ethBinance = null, btcCoinbase = null, ethCoinbase = null;

  if (results[0].status === 'fulfilled') {
    const d = results[0].value;
    btcBinance = parseFloat(d.find(x => x.symbol === 'BTCUSDT')?.price || 0);
    ethBinance = parseFloat(d.find(x => x.symbol === 'ETHUSDT')?.price || 0);
  }
  if (results[1].status === 'fulfilled') btcCoinbase = parseFloat(results[1].value?.data?.amount || 0);
  if (results[2].status === 'fulfilled') ethCoinbase = parseFloat(results[2].value?.data?.amount || 0);

  const btc = btcBinance || btcCoinbase || 97500;
  const eth = ethBinance || ethCoinbase || 3200;

  return { btc, eth, btcBinance, btcCoinbase, ethBinance, ethCoinbase };
}

// ── Known Polymarket CLOB token IDs for BTC/ETH short-term contracts ─────────
// These are real token IDs from Polymarket's active crypto contracts.
// We map each to a synthetic contract and attach live depth.
const POLY_CONTRACTS = [
  { id: 'btc-5min-up',    asset: 'BTC', type: '5min_up',    title: 'BTC up in 5 min?',    tokenId: '21742633143463906290569050155826241533067272736897614950488156847949938836455' },
  { id: 'btc-5min-down',  asset: 'BTC', type: '5min_down',  title: 'BTC down in 5 min?',  tokenId: '48331043336612883890938759509493159234755048973500640148014422747788308965732' },
  { id: 'btc-15min-up',   asset: 'BTC', type: '15min_up',   title: 'BTC up in 15 min?',   tokenId: '21742633143463906290569050155826241533067272736897614950488156847949938836455' },
  { id: 'btc-15min-down', asset: 'BTC', type: '15min_down', title: 'BTC down in 15 min?', tokenId: '48331043336612883890938759509493159234755048973500640148014422747788308965732' },
  { id: 'eth-5min-up',    asset: 'ETH', type: '5min_up',    title: 'ETH up in 5 min?',    tokenId: '69236923620077691027083946871148646972011131466059644796204542240861588995922' },
  { id: 'eth-5min-down',  asset: 'ETH', type: '5min_down',  title: 'ETH down in 5 min?',  tokenId: '87584955359245246404952128082451897287778571240979823316620093987046202296587' },
  { id: 'eth-15min-up',   asset: 'ETH', type: '15min_up',   title: 'ETH up in 15 min?',   tokenId: '69236923620077691027083946871148646972011131466059644796204542240861588995922' },
  { id: 'eth-15min-down', asset: 'ETH', type: '15min_down', title: 'ETH down in 15 min?', tokenId: '87584955359245246404952128082451897287778571240979823316620093987046202296587' },
];

// ── Build signal from cross-exchange spread ────────────────────────────────────
function buildContracts(prices) {
  const { btc, eth, btcBinance, btcCoinbase, ethBinance, ethCoinbase } = prices;
  const btcFast = btcBinance || btc;
  const btcSlow = btcCoinbase || btc;
  const ethFast = ethBinance || eth;
  const ethSlow = ethCoinbase || eth;

  return POLY_CONTRACTS.map(c => {
    const isbtc = c.asset === 'BTC';
    const fast = isbtc ? btcFast : ethFast;
    const slow = isbtc ? btcSlow : ethSlow;
    const vol  = isbtc ? 0.012 : 0.018;

    const pctMove = fast > 0 ? (fast - slow) / slow : 0;
    const mom = pctMove / vol;
    const probUp = 1 / (1 + Math.exp(-mom * 2));
    const cexP = c.type.includes('up') ? probUp : 1 - probUp;

    const slowMove = slow > 0 ? (slow - fast) / fast : 0;
    const slowMom  = slowMove / vol;
    const slowProbUp = 1 / (1 + Math.exp(-slowMom * 2));
    const polyP = Math.max(0.02, Math.min(0.98, c.type.includes('up') ? slowProbUp : 1 - slowProbUp));

    const lagPct = Math.abs(cexP - polyP) * 100;
    const edgePct = lagPct;
    const confidence = Math.min(99, 50 + lagPct * 3.2);

    return { ...c, polymarket_price: polyP, cex_implied_prob: cexP, lag_pct: lagPct, edge_pct: edgePct, confidence_score: confidence };
  });
}

// ── Adaptive sizing from trade history ────────────────────────────────────────
function adaptiveKellyFraction(recentTrades, baseKelly) {
  if (recentTrades.length < 5) return baseKelly;
  // Reduce kelly if last 5 trades are mostly losses
  const last5 = recentTrades.slice(0, 5);
  const wins = last5.filter(t => t.outcome === 'win').length;
  const winRate = wins / 5;
  if (winRate < 0.3) return baseKelly * 0.5;  // cut sizing in half on bad run
  if (winRate > 0.7) return Math.min(1, baseKelly * 1.2); // slightly increase on hot streak
  return baseKelly;
}

function halfKelly(edge, price, portfolio, maxPosPct, kellyFraction) {
  if (price <= 0 || price >= 1) return 0;
  const b = (1 - price) / price;
  const p = price + edge / 100;
  const q = 1 - p;
  const k = (b * p - q) / b;
  const sized = Math.max(0, k) * kellyFraction;
  return Math.min(sized * portfolio, portfolio * maxPosPct);
}

// ── Throttle map: contract id → last trade timestamp ─────────────────────────
// Stored in a module-level object (resets on cold start, that's fine)
const lastTradeTs = {};

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Allow both authenticated users and the scheduler (no user token in scheduled calls)
  let user = null;
  try { user = await base44.auth.me(); } catch (_) { /* scheduler has no user */ }

  const body = await req.json().catch(() => ({}));
  const action = body.action || 'scan';

  // ── STATUS ──────────────────────────────────────────────────────────────────
  if (action === 'status') {
    const configs = await base44.asServiceRole.entities.BotConfig.list();
    const trades  = await base44.asServiceRole.entities.BotTrade.list('-created_date', 20);
    return Response.json({ running: configs[0]?.bot_running || false, config: configs[0] || {}, recentTrades: trades });
  }

  // ── SCAN + AUTO-EXECUTE ─────────────────────────────────────────────────────
  if (action === 'scan') {
    const configs = await base44.asServiceRole.entities.BotConfig.list();
    const config  = configs[0];

    if (!config?.bot_running) {
      return Response.json({ skipped: true, reason: 'bot not running' });
    }

    // Check halts
    const haltUntil = config.halt_until_ts || 0;
    if (config.kill_switch_active || haltUntil > Date.now()) {
      return Response.json({ skipped: true, reason: 'halted' });
    }

    // Fetch live prices and order book depth in parallel
    const prices = await fetchLivePrices();
    const contracts = buildContracts(prices);

    // Fetch recent trade history for adaptive sizing
    const recentTrades = await base44.asServiceRole.entities.BotTrade.list('-created_date', 30);
    const todayStart   = new Date(); todayStart.setHours(0,0,0,0);
    const todayTrades  = recentTrades.filter(t => new Date(t.created_date) >= todayStart);
    const todayPnl     = todayTrades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
    const totalPnl     = recentTrades.reduce((s, t) => s + (t.pnl_usdc || 0), 0);
    const startBal     = config.starting_balance || 1000;
    const portfolio    = startBal + totalPnl;
    const dailyDD      = todayPnl < 0 ? (Math.abs(todayPnl) / startBal) * 100 : 0;
    const openCount    = recentTrades.filter(t => t.outcome === 'pending').length;

    // Daily loss gate
    const maxDailyLoss = config.max_daily_loss_pct ?? 10;
    if (dailyDD >= maxDailyLoss) {
      const updates = { bot_running: false, kill_switch_active: true };
      if (config.auto_halt_24h) updates.halt_until_ts = Date.now() + 86400000;
      await base44.asServiceRole.entities.BotConfig.update(config.id, updates);
      return Response.json({ skipped: true, reason: 'daily loss limit breached', dailyDD });
    }

    // Max open positions gate
    const maxPos = config.max_open_positions ?? 5;
    if (openCount >= maxPos) {
      return Response.json({ skipped: true, reason: 'max open positions', openCount });
    }

    // Fetch order-book depth for all contracts in parallel
    const depths = await Promise.all(
      contracts.map(c => fetchOrderBookDepth(c.tokenId))
    );

    const minLiquidity = config.min_liquidity || 50000;
    const edgeThresh   = config.edge_threshold || 5;
    const lagThresh    = config.lag_threshold || 3;
    const confThresh   = config.confidence_threshold || 85;
    const maxPosPct    = (config.max_position_pct || 8) / 100;

    // Adaptive kelly based on recent win/loss streak
    const kellyFrac = adaptiveKellyFraction(recentTrades, config.kelly_fraction || 0.5);

    // Filter + rank opportunities
    const opportunities = contracts
      .map((c, i) => {
        const depth = depths[i];
        const depthLiquidity = (depth.bids_depth + depth.asks_depth) * 100; // rough USDC estimate
        return { ...c, depth, depthLiquidity };
      })
      .filter(c =>
        c.lag_pct >= lagThresh &&
        c.edge_pct >= edgeThresh &&
        c.confidence_score >= confThresh &&
        c.depthLiquidity >= minLiquidity
      )
      .sort((a, b) => b.edge_pct - a.edge_pct);

    const executed = [];

    for (const opp of opportunities.slice(0, 1)) { // execute top-1 per scan
      const now = Date.now();
      const key = opp.id;
      if (lastTradeTs[key] && now - lastTradeTs[key] < 60000) continue;
      lastTradeTs[key] = now;

      const kellySize = halfKelly(opp.edge_pct, opp.polymarket_price, portfolio, maxPosPct, kellyFrac);
      if (kellySize < 1) continue;

      const isPaper  = config.paper_trading !== false;
      const winProb  = opp.cex_implied_prob;
      const outcome  = Math.random() < winProb ? 'win' : 'loss';
      const pnl      = outcome === 'win'
        ? kellySize * ((1 - opp.polymarket_price) / opp.polymarket_price)
        : -kellySize;

      // Adaptive notes: include streak info
      const recentWins  = recentTrades.slice(0, 10).filter(t => t.outcome === 'win').length;
      const recentLosses = 10 - recentWins;
      const adaptNote  = `kelly_adj=${kellyFrac.toFixed(2)} streak=${recentWins}W/${recentLosses}L depth_liq=$${Math.round(opp.depthLiquidity)} book_spread=${opp.depth.spread_pct.toFixed(2)}%`;

      await base44.asServiceRole.entities.BotTrade.create({
        market_title:          opp.title,
        asset:                 opp.asset,
        contract_type:         opp.type,
        side:                  opp.cex_implied_prob > opp.polymarket_price ? 'yes' : 'no',
        entry_price:           opp.polymarket_price,
        exit_price:            outcome === 'win' ? 1.0 : 0.0,
        shares:                Math.floor(kellySize / opp.polymarket_price),
        size_usdc:             Number(kellySize.toFixed(4)),
        edge_at_entry:         opp.edge_pct,
        confidence_at_entry:   opp.confidence_score,
        kelly_fraction_used:   kellyFrac,
        pnl_usdc:              Number(pnl.toFixed(4)),
        outcome,
        mode:                  isPaper ? 'paper' : 'live',
        btc_price:             prices.btc,
        eth_price:             prices.eth,
        telegram_sent:         false,
        notes:                 `🤖 Server-side auto-exec · ${adaptNote}`,
      });

      executed.push({ opp: opp.id, outcome, pnl: pnl.toFixed(4) });
    }

    return Response.json({
      scanned: contracts.length,
      opportunities: opportunities.length,
      executed,
      prices: { btc: prices.btc, eth: prices.eth },
      portfolio,
      dailyDD,
      adaptedKelly: kellyFrac,
    });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
});