// Returns live bot thresholds from ArbConfig so the droplet can hot-reload
// without redeploying. Authenticated via Bearer DROPLET_SECRET | BOT_SECRET | USER_TOKEN,
// or via a logged-in admin session.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Auth: droplet shared secret OR logged-in user
    const authHeader = req.headers.get('authorization') || '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const dropletSecret = Deno.env.get('DROPLET_SECRET') || '';
    const botSecret = Deno.env.get('BOT_SECRET') || '';
    const userToken = Deno.env.get('BASE44_USER_TOKEN') || '';
    const isDroplet = !!bearer && (bearer === dropletSecret || bearer === botSecret || bearer === userToken);

    let user = null;
    if (!isDroplet) {
      try { user = await base44.auth.me(); } catch { /* ignore */ }
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const configs = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const cfg = configs[0] || {};

    // Use the smallest per-asset edge as the global floor so the bot still surfaces
    // good signals on any asset. Default 5 bps if nothing configured.
    const edges = [cfg.btc_min_edge_bps, cfg.eth_min_edge_bps, cfg.sol_min_edge_bps]
      .map(Number).filter(n => Number.isFinite(n) && n > 0);
    const minNetEdgeBps = edges.length ? Math.min(...edges) : 5;
    const minFillableUsd = Number(cfg.min_fillable_usd) || 200;

    return Response.json({
      ok: true,
      min_net_edge_bps: minNetEdgeBps,
      min_fillable_usd: minFillableUsd,
      bot_running: !!cfg.bot_running,
      kill_switch_active: !!cfg.kill_switch_active,
      updated_at: cfg.updated_date || null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});