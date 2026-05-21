// startStopBot — sets bot_running flag in ArbConfig and optionally triggers droplet restart
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action; // 'start' | 'stop' | 'sync'

    if (!['start', 'stop', 'sync'].includes(action)) {
      return Response.json({ error: 'action must be "start", "stop", or "sync"' }, { status: 400 });
    }

    const isStart = action === 'start';

    // Update ArbConfig
    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config = configs?.[0];
    if (!config) return Response.json({ error: 'No ArbConfig found' }, { status: 400 });

    if (action === 'sync') {
      const latest = await base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 1);
      const last = latest?.[0];
      const lastMs = last ? Date.now() - new Date(last.snapshot_time).getTime() : Infinity;
      const dropletHealthy = Number.isFinite(lastMs) && lastMs < 120_000;

      if (dropletHealthy && !config.kill_switch_active && !config.bot_running) {
        await base44.asServiceRole.entities.ArbConfig.update(config.id, { bot_running: true });
        return Response.json({ ok: true, action, bot_running: true, synced_from_heartbeat: true });
      }

      return Response.json({ ok: true, action, bot_running: !!config.bot_running, synced_from_heartbeat: false });
    }

    const updates = { bot_running: isStart };
    if (isStart) updates.kill_switch_active = false; // always clear kill switch on manual start
    await base44.asServiceRole.entities.ArbConfig.update(config.id, updates);

    // If starting, also restart the droplet bot process
    if (isStart) {
      const dropletIp = Deno.env.get('DROPLET_IP');
      const dropletSecret = Deno.env.get('DROPLET_SECRET');
      const port = Deno.env.get('ORDER_SERVER_PORT') || '4001';

      if (dropletIp && dropletSecret) {
        try {
          await fetch(`http://${dropletIp}:${port}/restart`, {
            method: 'POST',
            headers: { 'x-droplet-secret': dropletSecret, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'restart' }),
            signal: AbortSignal.timeout(5000),
          });
        } catch (e) {
          console.warn('[startStopBot] droplet restart failed (non-fatal):', e.message);
        }
      }
    }

    return Response.json({ ok: true, action, bot_running: isStart });
  } catch (error) {
    console.error('[startStopBot] error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});