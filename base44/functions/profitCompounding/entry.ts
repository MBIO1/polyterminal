// Profit Compounding Module
//
// Automatically compounds profits to grow portfolio:
// 1. Track daily/weekly profits
// 2. Compound 70% of profits back into trading capital
// 3. Reserve 30% to safe storage
// 4. Adjust position sizes as capital grows

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMPOUND_RATIO = 0.70;
const MIN_PROFIT_TO_COMPOUND = 100; // Minimum $100 profit to trigger compounding

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action = 'status', manualAmount, manualRatio } = body;

    // Get config
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config = configs[0];
    if (!config) return Response.json({ error: 'No config found' }, { status: 404 });

    // Get all closed trades
    const allTrades = await base44.asServiceRole.entities.ArbTrade.filter(
      { status: 'Closed' }, '-exit_timestamp', 5000
    );

    const totalProfit = allTrades.reduce((sum, t) => sum + Number(t.net_pnl || 0), 0);
    const winningTrades = allTrades.filter(t => Number(t.net_pnl || 0) > 0);
    const losingTrades  = allTrades.filter(t => Number(t.net_pnl || 0) < 0);
    const winRate = allTrades.length > 0 ? winningTrades.length / allTrades.length : 0;

    const compoundedSoFar = config.compounded_profits_total || 0;
    const reservedSoFar   = config.reserved_profits_total   || 0;
    const currentCapital  = Number(config.total_capital || 0);
    const startingCapital = currentCapital - compoundedSoFar;

    // --- STATUS ---
    if (action === 'status') {
      // Calculate yesterday's P&L
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = yesterday.toISOString().slice(0, 10);
      const todayStr = new Date().toISOString().slice(0, 10);

      const todayTrades = allTrades.filter(t => (t.trade_date || '').startsWith(todayStr));
      const yesterdayTrades = allTrades.filter(t => (t.trade_date || '').startsWith(yStr));
      const todayPnl = todayTrades.reduce((s, t) => s + Number(t.net_pnl || 0), 0);
      const yesterdayPnl = yesterdayTrades.reduce((s, t) => s + Number(t.net_pnl || 0), 0);

      const lastCompoundDate = config.last_compound_at
        ? new Date(config.last_compound_at).toISOString().slice(0, 10)
        : null;
      const alreadyCompoundedToday = lastCompoundDate === todayStr;

      const shouldCompound = yesterdayPnl > MIN_PROFIT_TO_COMPOUND && !alreadyCompoundedToday;

      return Response.json({
        ok: true,
        currentCapital,
        startingCapital,
        totalProfit,
        totalReturn: startingCapital > 0 ? ((totalProfit / startingCapital) * 100).toFixed(2) + '%' : '0%',
        compoundedProfits: compoundedSoFar,
        reservedProfits: reservedSoFar,
        compoundCount: config.compound_count || 0,
        lastCompound: config.last_compound_at || null,
        compoundRatio: COMPOUND_RATIO,
        tradeStats: {
          total: allTrades.length,
          winning: winningTrades.length,
          losing: losingTrades.length,
          winRate: (winRate * 100).toFixed(1) + '%',
          avgWin: winningTrades.length > 0
            ? winningTrades.reduce((s, t) => s + Number(t.net_pnl || 0), 0) / winningTrades.length
            : 0,
          avgLoss: losingTrades.length > 0
            ? losingTrades.reduce((s, t) => s + Number(t.net_pnl || 0), 0) / losingTrades.length
            : 0,
        },
        daily: {
          today: { pnl: todayPnl, trades: todayTrades.length },
          yesterday: { pnl: yesterdayPnl, trades: yesterdayTrades.length },
        },
        pending: {
          shouldCompound,
          profit: yesterdayPnl,
          compoundAmount: shouldCompound ? yesterdayPnl * COMPOUND_RATIO : 0,
          reserveAmount:  shouldCompound ? yesterdayPnl * (1 - COMPOUND_RATIO) : 0,
          reason: alreadyCompoundedToday ? 'already_compounded_today'
            : yesterdayPnl <= 0 ? 'no_profit_yesterday'
            : yesterdayPnl < MIN_PROFIT_TO_COMPOUND ? 'below_minimum'
            : 'ready',
        },
      });
    }

    // --- EXECUTE COMPOUNDING ---
    if (action === 'compound') {
      const profit = manualAmount || 0;
      const ratio  = manualRatio  || COMPOUND_RATIO;

      if (profit <= 0) {
        return Response.json({ error: 'No positive profit to compound' }, { status: 400 });
      }
      if (profit < MIN_PROFIT_TO_COMPOUND && !manualAmount) {
        return Response.json({ error: `Profit $${profit} below minimum $${MIN_PROFIT_TO_COMPOUND}` }, { status: 400 });
      }

      const compoundAmount = profit * ratio;
      const reserveAmount  = profit * (1 - ratio);
      const newCapital = currentCapital + compoundAmount;

      await base44.asServiceRole.entities.ArbConfig.update(config.id, {
        total_capital: newCapital,
        last_compound_at: new Date().toISOString(),
        compounded_profits_total: compoundedSoFar + compoundAmount,
        reserved_profits_total:   reservedSoFar   + reserveAmount,
        compound_count: (config.compound_count || 0) + 1,
      });

      console.log(`[profitCompounding] Compounded $${compoundAmount.toFixed(2)} of $${profit.toFixed(2)} profit. New capital: $${newCapital.toFixed(2)}`);

      return Response.json({
        ok: true,
        success: true,
        previousCapital: currentCapital,
        newCapital,
        profit,
        compoundAmount,
        reserveAmount,
        compoundRatio: ratio,
        timestamp: new Date().toISOString(),
      });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });

  } catch (error) {
    console.error('[profitCompounding] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});