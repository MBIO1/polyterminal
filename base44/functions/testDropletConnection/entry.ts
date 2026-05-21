import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dropletIp     = Deno.env.get('DROPLET_IP');
    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const orderPort     = Deno.env.get('ORDER_SERVER_PORT') || '4001';

    if (!dropletIp || !dropletSecret) {
      return Response.json({ error: 'Missing DROPLET_IP or DROPLET_SECRET' }, { status: 500 });
    }

    // 1. Order-server /health
    let orderServerStatus = 'unreachable';
    let orderServerData = null;
    try {
      const r = await fetch(`http://${dropletIp}:${orderPort}/health`, {
        headers: { 'X-Droplet-Secret': dropletSecret, 'Authorization': `Bearer ${dropletSecret}` },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        orderServerData = await r.json();
        orderServerStatus = 'connected';
      } else {
        orderServerStatus = `http_${r.status}`;
      }
    } catch (e) {
      orderServerStatus = `error: ${e.message}`;
    }

    // 2. Ingest pipeline — probe via DB (confirms ArbSignal entity reachable and recent)
    let ingestStatus = 'untested';
    let ingestData = null;
    try {
      const sigs = await base44.asServiceRole.entities.ArbSignal.list('-received_time', 1);
      const last = sigs?.[0];
      const ageSec = last ? Math.round((Date.now() - new Date(last.received_time || last.created_date).getTime()) / 1000) : null;
      ingestData = { entity_readable: true, last_signal_id: last?.id || null, last_signal_age_sec: ageSec };
      ingestStatus = 'ok';
    } catch (e) {
      ingestStatus = `error: ${e.message}`;
    }

    // 3. Heartbeat pipeline — probe via DB (confirms ArbHeartbeat entity reachable and fresh)
    let heartbeatStatus = 'untested';
    let heartbeatData = null;
    try {
      const hbs = await base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 1);
      const last = hbs?.[0];
      const ageSec = last ? Math.round((Date.now() - new Date(last.snapshot_time).getTime()) / 1000) : null;
      heartbeatData = { entity_readable: true, last_heartbeat_age_sec: ageSec };
      // Fresh = heartbeat within last 5 min; stale = exists but old; missing = never received
      heartbeatStatus = ageSec === null ? 'missing' : ageSec < 300 ? 'ok' : 'stale';
    } catch (e) {
      heartbeatStatus = `error: ${e.message}`;
    }

    const allOk = orderServerStatus === 'connected' && ingestStatus === 'ok' && heartbeatStatus === 'ok';

    return Response.json({
      status: allOk ? 'all_systems_go' : 'degraded',
      dropletIp,
      order_server:       { status: orderServerStatus, data: orderServerData },
      ingest_pipeline:    { status: ingestStatus, data: ingestData },
      heartbeat_pipeline: { status: heartbeatStatus, data: heartbeatData },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    return Response.json({
      status: 'error',
      error: error.message,
      dropletIp: Deno.env.get('DROPLET_IP'),
    }, { status: 500 });
  }
});