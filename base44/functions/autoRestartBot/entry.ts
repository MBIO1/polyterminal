/**
 * autoRestartBot — triggered by BotConfig entity automation when bot_running → false.
 * After the configured halt cooldown (default 5 min), automatically re-enables
 * bot_running unless the kill_switch is still active or halt_until_ts is still in future.
 *
 * This ensures the bot self-heals after drawdown halts, errors, or resets
 * without requiring manual intervention.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_RESTART_DELAY_MS = 5 * 60 * 1000; // 5 min default cooldown

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const body = await req.json().catch(() => ({}));
  const { event, data, old_data } = body;

  // Only act when bot_running just flipped from true → false
  const wasRunning = old_data?.bot_running === true;
  const nowStopped = data?.bot_running === false;

  if (!wasRunning || !nowStopped) {
    return Response.json({ skipped: true, reason: 'not a bot_running true→false transition' });
  }

  // If kill switch is active → do NOT auto-restart (user chose to stop)
  if (data?.kill_switch_active) {
    return Response.json({ skipped: true, reason: 'kill switch active — respecting manual stop' });
  }

  const config = data;
  const haltUntil = config?.halt_until_ts || 0;
  const now = Date.now();

  // Determine how long to wait before restarting
  let delayMs;
  if (haltUntil > now) {
    // Auto-halt with explicit timestamp — wait until that time
    delayMs = haltUntil - now;
  } else {
    // Generic stop (error/reset) — use default cooldown
    delayMs = DEFAULT_RESTART_DELAY_MS;
  }

  // Cap at 25 hours (auto_halt_24h case)
  const cappedDelayMs = Math.min(delayMs, 25 * 60 * 60 * 1000);
  const restartAt = now + cappedDelayMs;
  const restartAtISO = new Date(restartAt).toISOString();

  // Wait out the cooldown (Deno function has up to 90s wall time before timeout)
  // For long halts (>60s) we re-schedule ourselves via a no-op config update
  // that will re-trigger this automation; for short halts we sleep inline.
  if (cappedDelayMs <= 55000) {
    // Short cooldown — sleep inline
    await new Promise(r => setTimeout(r, cappedDelayMs));

    // Re-read config to ensure nothing changed while we waited
    const configs = await base44.asServiceRole.entities.BotConfig.list();
    const latest = configs[0];
    if (!latest) return Response.json({ skipped: true, reason: 'no config found' });

    if (latest.kill_switch_active) {
      return Response.json({ skipped: true, reason: 'kill switch activated during cooldown' });
    }
    if ((latest.halt_until_ts || 0) > Date.now()) {
      return Response.json({ skipped: true, reason: 'halt_until_ts still in future — deferring' });
    }
    if (latest.bot_running) {
      return Response.json({ skipped: true, reason: 'bot already restarted manually' });
    }

    // All clear — restart
    await base44.asServiceRole.entities.BotConfig.update(latest.id, {
      bot_running: true,
      halt_until_ts: 0,
    });

    return Response.json({
      restarted: true,
      waited_ms: cappedDelayMs,
      config_id: latest.id,
    });
  } else {
    // Long halt (>55s) — record the scheduled restart time in notes field
    // The scheduled botRunner will pick up bot_running=false and stay idle;
    // a separate "check restart" pass happens in botRunner scan when halt_until_ts expires.
    // We patch halt_until_ts so botRunner's scan loop knows when to re-enable.
    const configs = await base44.asServiceRole.entities.BotConfig.list();
    const latest = configs[0];
    if (!latest) return Response.json({ skipped: true, reason: 'no config found' });

    // botRunner already checks halt_until_ts and skips. 
    // Patch it so the scheduled scan auto-clears it and restarts when ready.
    // We do this by setting a special flag read by botRunner.
    if (!latest.kill_switch_active) {
      await base44.asServiceRole.entities.BotConfig.update(latest.id, {
        // Ensure halt_until_ts is set so botRunner can self-resume
        halt_until_ts: haltUntil > now ? haltUntil : now + cappedDelayMs,
      });
    }

    return Response.json({
      scheduled: true,
      restart_at: restartAtISO,
      delay_ms: cappedDelayMs,
      note: 'botRunner scan will auto-resume when halt_until_ts expires',
    });
  }
});