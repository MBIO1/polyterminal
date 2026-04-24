// Critical Droplet Alert System
// 
// Sends immediate alerts when droplet goes offline or comes back online
// Integrates with Telegram for real-time notifications

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID');

// Thresholds
const OFFLINE_THRESHOLD_SEC  = 180;  // 3 min = offline
const CRITICAL_THRESHOLD_SEC = 600;  // 10 min = critical

async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[CriticalAlert] Telegram not configured');
    return { sent: false };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error('[CriticalAlert] Telegram failed:', await res.text());
      return { sent: false };
    }
    return { sent: true };
  } catch (e) {
    console.error('[CriticalAlert] Telegram error:', e.message);
    return { sent: false };
  }
}

function formatOfflineAlert(offlineSec, isCritical) {
  const minutes = Math.floor(offlineSec / 60);
  const hours   = Math.floor(minutes / 60);
  const emoji   = isCritical ? '🚨' : '⚠️';
  const level   = isCritical ? 'CRITICAL' : 'WARNING';

  let msg = `${emoji} <b>DROPLET ${level}</b> ${emoji}\n`;
  msg += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += hours > 0
    ? `⏱ <b>Offline for:</b> ${hours}h ${minutes % 60}m\n`
    : `⏱ <b>Offline for:</b> ${minutes}m\n`;
  msg += '\n<b>Action Required:</b>\n';
  msg += 'SSH to droplet and restart:\n';
  msg += '<code>pm2 restart bot.mjs</code>\n\n';
  if (isCritical) {
    msg += '🔴 <b>No trades are being executed!</b>\n';
    msg += 'Markets are being missed.\n\n';
  }
  msg += `<i>Alert time: ${new Date().toUTCString()}</i>`;
  return msg;
}

function formatRecoveryAlert(downtimeSec) {
  const minutes = Math.floor(downtimeSec / 60);
  const hours   = Math.floor(minutes / 60);

  let msg = '✅ <b>DROPLET RECOVERED</b> ✅\n';
  msg += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += '🟢 Droplet is back online\n';
  msg += hours > 0
    ? `⏱ <b>Downtime:</b> ${hours}h ${minutes % 60}m\n`
    : `⏱ <b>Downtime:</b> ${minutes}m\n`;
  msg += `🕐 <b>Recovered at:</b> ${new Date().toUTCString()}\n\n`;
  msg += '<i>Monitoring resumed.</i>';
  return msg;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // No auth required — this is called by the scheduler

    const now = Date.now();

    // Get latest heartbeats (last 10 for history)
    const heartbeats = await base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 10);
    const lastHb     = heartbeats?.[0];

    if (!lastHb) {
      return Response.json({ ok: true, status: 'no_data', alertSent: false });
    }

    const lastHeartbeatTime = new Date(lastHb.snapshot_time).getTime();
    const offlineSec        = Math.floor((now - lastHeartbeatTime) / 1000);

    let currentStatus = 'healthy';
    if (offlineSec >= CRITICAL_THRESHOLD_SEC)      currentStatus = 'critical';
    else if (offlineSec >= OFFLINE_THRESHOLD_SEC)  currentStatus = 'offline';

    // Load alert state from config (reuse ArbConfig for simplicity)
    const configs     = await base44.asServiceRole.entities.ArbConfig.list('-created_date', 1);
    const config      = configs?.[0];
    const lastAlertTs = config?.last_alert_ts || 0;
    const lastAlertStatus = config?.last_alert_status || 'healthy';
    const offlineStartTs  = config?.offline_start_ts  || null;

    const COOLDOWN_SEC = 300; // 5 min between repeat alerts
    const timeSinceLast = (now - lastAlertTs) / 1000;

    let alertSent    = false;
    let recoverySent = false;
    let configUpdate = {};

    // Recovery detection
    if ((lastAlertStatus === 'offline' || lastAlertStatus === 'critical') && currentStatus === 'healthy') {
      const downtime = offlineStartTs ? Math.floor((now - offlineStartTs) / 1000) : offlineSec;
      const result   = await sendTelegramAlert(formatRecoveryAlert(downtime));
      recoverySent   = result.sent;
      configUpdate   = { last_alert_ts: now, last_alert_status: 'healthy', offline_start_ts: null };
      console.log(`[CriticalAlert] Recovery alert sent. Downtime: ${downtime}s`);
    }

    // Offline/critical alert
    if ((currentStatus === 'offline' || currentStatus === 'critical') && timeSinceLast >= COOLDOWN_SEC) {
      const startTs   = offlineStartTs || (now - offlineSec * 1000);
      const isCrit    = currentStatus === 'critical';
      const result    = await sendTelegramAlert(formatOfflineAlert(offlineSec, isCrit));
      alertSent       = result.sent;
      configUpdate    = { last_alert_ts: now, last_alert_status: currentStatus, offline_start_ts: startTs };
      console.log(`[CriticalAlert] ${currentStatus.toUpperCase()} alert sent. Offline: ${offlineSec}s`);
    } else if (currentStatus === 'offline' || currentStatus === 'critical') {
      // Update status even if in cooldown
      if (!configUpdate.last_alert_status) {
        configUpdate = { last_alert_status: currentStatus, offline_start_ts: offlineStartTs || (now - offlineSec * 1000) };
      }
    }

    // Persist state to config
    if (config && Object.keys(configUpdate).length > 0) {
      await base44.asServiceRole.entities.ArbConfig.update(config.id, configUpdate).catch(e =>
        console.error('[CriticalAlert] Config update failed:', e.message)
      );
    }

    return Response.json({
      ok:           true,
      checked_at:   new Date().toISOString(),
      status:       currentStatus,
      offlineSec,
      lastHeartbeat: lastHb.snapshot_time,
      alertSent,
      recoverySent,
      cooldownRemaining: Math.max(0, COOLDOWN_SEC - timeSinceLast),
    });

  } catch (error) {
    console.error('[CriticalAlert] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});