/**
 * autoRestartBot — Entity automation triggered when BotConfig.bot_running → false.
 *
 * DESIGN: Deno functions have a ~90s wall-clock limit.
 * We CANNOT sleep inline for long halts. Instead:
 *   - We just ensure halt_until_ts is set correctly.
 *   - The scheduled botRunner (every 5 min) checks halt_until_ts and auto-resumes.
 *   - For generic stops (no halt_until_ts), we set a short 2-min cooldown so botRunner
 *     picks it up on the next scan.
 *
 * CRITICAL RULES:
 *   - kill_switch_active is a MANUAL-only lever. We never set it automatically.
 *   - We NEVER sleep — botRunner handles the actual resume.
 *   - If kill_switch is active, we do NOT auto-restart.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_COOLDOWN_MS = 2 * 60 * 1000; // 2 min for generic stops

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const body = await req.json().catch(() => ({}));
  const { data, old_data } = body;

  // Only act when bot_running just flipped true → false
  const wasRunning = old_data?.bot_running === true;
  const nowStopped = data?.bot_running === false;

  if (!wasRunning || !nowStopped) {
    return Response.json({ skipped: true, reason: 'not a bot_running true→false transition' });
  }

  // If kill switch is manually active → respect user's decision, do not restart
  if (data?.kill_switch_active) {
    return Response.json({ skipped: true, reason: 'kill_switch_active — manual stop, not auto-restarting' });
  }

  // Re-read fresh config to avoid race conditions
  const configs = await base44.asServiceRole.entities.BotConfig.list();
  const config = configs[0];
  if (!config) return Response.json({ skipped: true, reason: 'no config found' });

  // If kill switch was set on the live record, still skip
  if (config.kill_switch_active) {
    return Response.json({ skipped: true, reason: 'kill_switch_active on live config' });
  }

  const now = Date.now();
  const existingHalt = config.halt_until_ts || 0;

  // Determine the restart time
  let restartAt;
  if (existingHalt > now) {
    // There's already a valid halt window — respect it
    restartAt = existingHalt;
  } else {
    // Generic stop (manual pause, error, reset) — short cooldown
    restartAt = now + DEFAULT_COOLDOWN_MS;
  }

  // Write halt_until_ts so the scheduled botRunner knows when to resume
  // (botRunner checks this every 5 min and auto-sets bot_running=true when it expires)
  await base44.asServiceRole.entities.BotConfig.update(config.id, {
    halt_until_ts: restartAt,
    // Ensure kill_switch is OFF so botRunner can resume
    kill_switch_active: false,
  });

  return Response.json({
    acknowledged: true,
    restart_at: new Date(restartAt).toISOString(),
    wait_ms: restartAt - now,
    note: 'botRunner scheduled scan will auto-resume when halt_until_ts expires',
  });
});