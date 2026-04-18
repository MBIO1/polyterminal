/**
 * Drawdown Guard — Monitor daily losses & wallet balance.
 * If total losses exceed daily limit, auto-halt bot to preserve capital.
 *
 * Triggered: every 2-5 minutes via automation
 * Updates: BotConfig.bot_running, halt_until_ts
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  
  try {
    // Fetch bot config + recent trades
    const configs = await base44.asServiceRole.entities.BotConfig.list();
    const config = configs[0];
    
    if (!config) {
      return Response.json({ error: 'No BotConfig found' }, { status: 400 });
    }

    const now = Date.now();
    const haltUntil = config.halt_until_ts || 0;
    const haltReset = config.halt_reset_ts || 0;
    
    // Check if already halted + halt window not expired
    if (config.halt_until_ts && haltUntil > now && config.bot_running === false) {
      const minsRemaining = Math.ceil((haltUntil - now) / 60000);
      return Response.json({
        status: 'halted',
        reason: `Halt window active (${minsRemaining}m remaining)`,
        config: { bot_running: config.bot_running, halt_until_ts: haltUntil },
      });
    }

    // Auto-resume if halt window expired
    if (haltUntil > 0 && haltUntil <= now && config.bot_running === false && !config.kill_switch_active) {
      await base44.asServiceRole.entities.BotConfig.update(config.id, {
        bot_running: true,
        halt_until_ts: 0,
      });
      return Response.json({ status: 'auto_resumed', reason: 'Halt window expired' });
    }

    if (!config.bot_running) {
      return Response.json({ status: 'skipped', reason: 'Bot not running' });
    }

    // ── Fetch recent trades (last 200) ────────────────────────────────────────
    const trades = await base44.asServiceRole.entities.BotTrade.list('-created_date', 200);
    
    // ── Calculate daily P&L ──────────────────────────────────────────────────
    // Daily window = from halt_reset_ts OR today at 00:00 UTC, whichever is more recent
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);
    const windowStart = Math.max(haltReset, todayUTC.getTime());
    const windowEnd = now;
    
    const todayTrades = trades.filter(t => {
      const tDate = new Date(t.created_date).getTime();
      return tDate >= windowStart && tDate <= windowEnd;
    });

    const dailyPnL = todayTrades.reduce((sum, t) => sum + (t.pnl_usdc || 0), 0);
    const totalLoss = todayTrades.filter(t => (t.pnl_usdc || 0) < 0).reduce((sum, t) => sum + Math.abs(t.pnl_usdc || 0), 0);
    const dailyDrawdownPct = (totalLoss / (config.starting_balance || 1000)) * 100;

    // ── Check drawdown thresholds ────────────────────────────────────────────
    const maxDailyLoss = config.max_daily_loss_pct ?? 20; // -20% daily halt
    const killSwitchThreshold = 40; // -40% permanent halt (cumulative)

    // ── Check cumulative portfolio drawdown (high water mark) ─────────────────
    const totalLosses = recentTrades.filter(t => (t.pnl_usdc || 0) < 0).reduce((s, t) => s + Math.abs(t.pnl_usdc || 0), 0);
    const cumulativeDrawdownPct = (totalLosses / (config.starting_balance || 1000)) * 100;

    let action = 'none';
    let reason = '';

    if (cumulativeDrawdownPct >= killSwitchThreshold) {
      // Kill switch: -40% cumulative loss (permanent halt, requires manual restart)
      await base44.asServiceRole.entities.BotConfig.update(config.id, {
        bot_running: false,
        kill_switch_active: true,
        halt_until_ts: now + 86400000 * 365, // effectively permanent
        halt_reset_ts: now,
      });
      action = 'kill_switch';
      reason = `Cumulative drawdown ${cumulativeDrawdownPct.toFixed(1)}% ≥ kill threshold ${killSwitchThreshold}% (permanent halt)`;
    } else if (dailyDrawdownPct >= maxDailyLoss) {
      // Daily halt: -20% daily loss (24h halt)
      await base44.asServiceRole.entities.BotConfig.update(config.id, {
        bot_running: false,
        kill_switch_active: false,
        halt_until_ts: now + 86400000, // 24h halt
        halt_reset_ts: now,
      });
      action = 'daily_halt';
      reason = `Daily drawdown ${dailyDrawdownPct.toFixed(1)}% ≥ limit ${maxDailyLoss}% (24h halt)`;
    }

    // ── Log drawdown event ───────────────────────────────────────────────────
    if (action !== 'none') {
      await base44.asServiceRole.entities.DrawdownLog.create({
        event_type: action === 'kill_switch' ? 'kill_switch' : 'daily_halt',
        drawdown_pct: action === 'kill_switch' ? cumulativeDrawdownPct : dailyDrawdownPct,
        portfolio_value: config.starting_balance || 1000,
        triggered_at_pct: action === 'kill_switch' ? killSwitchThreshold : maxDailyLoss,
        message: reason,
        resolved: false,
      });
    }

    return Response.json({
      action,
      reason,
      dailyPnL: dailyPnL.toFixed(2),
      dailyLoss: totalLoss.toFixed(2),
      dailyDrawdownPct: dailyDrawdownPct.toFixed(2),
      cumulativeDrawdownPct: cumulativeDrawdownPct.toFixed(2),
      maxDailyLoss,
      killSwitchThreshold,
      tradeCount: todayTrades.length,
      botRunning: config.bot_running,
      haltUntil: config.halt_until_ts,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});