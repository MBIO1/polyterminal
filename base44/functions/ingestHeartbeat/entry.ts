// Receives minute-level heartbeats from the droplet bot and stores them as ArbHeartbeat rows.
// Accepts auth via: user token OR droplet IP/secret

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID');

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(8000),
  }).catch(e => console.error('[ingestHeartbeat] Telegram error:', e.message));
}

function getClientIP(req) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         req.headers.get('cf-connecting-ip') ||
         'unknown';
}

Deno.serve(async (req) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const clientIP = getClientIP(req);

  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'POST only' }, { status: 405 });
    }

    // Droplet auth only: IP or secret header
    const isDroplet = clientIP === Deno.env.get('DROPLET_IP') ||
                      req.headers.get('x-droplet-auth') === Deno.env.get('DROPLET_SECRET');

    if (!isDroplet) {
      return Response.json({ error: 'Unauthorized: droplet or user token required' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);

    // Parse body
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const now = new Date().toISOString();

    const heartbeat = await base44.asServiceRole.entities.ArbHeartbeat.create({
      snapshot_time: body.snapshot_time || now,
      received_time: now,
      evaluations: Number(body.evaluations) || 0,
      posted: Number(body.posted) || 0,
      rejected_edge: Number(body.rejected_edge) || 0,
      rejected_fillable: Number(body.rejected_fillable) || 0,
      rejected_stale: Number(body.rejected_stale) || 0,
      rejected_dedupe: Number(body.rejected_dedupe) || 0,
      best_edge_bps: Number(body.best_edge_bps) || 0,
      best_edge_pair: String(body.best_edge_pair || '').slice(0, 20),
      best_edge_route: String(body.best_edge_route || '').slice(0, 100),
      bucket_0_5: Number(body.bucket_0_5) || 0,
      bucket_5_10: Number(body.bucket_5_10) || 0,
      bucket_10_15: Number(body.bucket_10_15) || 0,
      bucket_15_20: Number(body.bucket_15_20) || 0,
      bucket_20_plus: Number(body.bucket_20_plus) || 0,
      fresh_books: String(body.fresh_books || '').slice(0, 500),
      min_edge_floor_bps: Number(body.min_edge_floor_bps) || 0,
      venue_pair_checks: Number(body.venue_pair_checks) || 0,
      venue_no_book: Number(body.venue_no_book) || 0,
      venue_stale_book: Number(body.venue_stale_book) || 0,
      passed_edge_gate: Number(body.passed_edge_gate) || 0,
      passed_fillable_gate: Number(body.passed_fillable_gate) || 0,
      passed_stale_gate: Number(body.passed_stale_gate) || 0,
      passed_dedupe_gate: Number(body.passed_dedupe_gate) || 0,
      post_attempts: Number(body.post_attempts) || 0,
      post_errors: Number(body.post_errors) || 0,
      post_non_2xx: Number(body.post_non_2xx) || 0,
    });

    console.log(`[ingestHeartbeat] accepted from ${isDroplet ? 'droplet' : 'user'} (${clientIP})`);

    // Email alert: zero evaluations or high rejected_fillable
    const zeroEvals = heartbeat.evaluations === 0;
    const highRejectedFillable = heartbeat.rejected_fillable > 0 && heartbeat.passed_edge_gate > 0
      && (heartbeat.rejected_fillable / heartbeat.passed_edge_gate) > 0.5;

    if (zeroEvals || highRejectedFillable) {
      const subject = zeroEvals ? '🚨 MBIO Bot: Zero Evaluations Detected' : '⚠️ MBIO Bot: High Fillable Rejection Rate';
      const reason = zeroEvals
        ? 'Zero evaluations detected — bot may be idle or disconnected.'
        : `High rejected_fillable: ${heartbeat.rejected_fillable} of ${heartbeat.passed_edge_gate} edge-passing signals rejected for insufficient liquidity.`;

      // Email alert
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: Deno.env.get('BASE44_EMAIL') || '',
        subject,
        body: `Alert triggered at ${now}\n\n${reason}\n\nHeartbeat snapshot time: ${heartbeat.snapshot_time}\nEvaluations: ${heartbeat.evaluations}\nRejected fillable: ${heartbeat.rejected_fillable}\nPassed edge gate: ${heartbeat.passed_edge_gate}`,
      }).catch(e => console.error('[ingestHeartbeat] email alert failed:', e.message));

      // Telegram alert — check toggle
      const alertCfg = (await base44.asServiceRole.entities.AlertThreshold.list('-created_date', 1))[0] || {};
      if (alertCfg.tg_heartbeat_alerts !== false) {
        const tgText = [
          zeroEvals ? '🚨 <b>ZERO EVALUATIONS DETECTED</b>' : '⚠️ <b>HIGH FILLABLE REJECTION RATE</b>',
          '━━━━━━━━━━━━━━━━━━━━',
          reason,
          `<b>Snapshot:</b> ${heartbeat.snapshot_time}`,
          `<b>Evaluations:</b> ${heartbeat.evaluations}`,
          `<b>Rejected fillable:</b> ${heartbeat.rejected_fillable}`,
          `<b>Passed edge gate:</b> ${heartbeat.passed_edge_gate}`,
          `<i>${now}</i>`,
        ].join('\n');
        await sendTelegram(tgText);
      }
    }

    return Response.json({ ok: true, heartbeat_id: heartbeat.id, alerted: zeroEvals || highRejectedFillable });

  } catch (error) {
    console.error('[ingestHeartbeat] error:', error.message);
    return Response.json({ error: error.message, requestId }, { status: 500 });
  }
});