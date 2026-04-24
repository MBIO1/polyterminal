// Critical Droplet Alert System
// 
// Sends immediate alerts when droplet goes offline or comes back online
// Integrates with Telegram for real-time notifications

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { auditLog } from '../lib/auditLogger.ts';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

// Alert thresholds
const OFFLINE_THRESHOLD_SEC = 180; // 3 minutes = offline
const CRITICAL_THRESHOLD_SEC = 600; // 10 minutes = critical
const ALERT_COOLDOWN_SEC = 300; // 5 minutes between repeat alerts

// Track alert state
let lastAlertTime = 0;
let lastStatus = 'unknown';
let offlineStartTime = null;

async function sendTelegramAlert(message, parseMode = 'HTML') {
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
        parse_mode: parseMode,
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
  const hours = Math.floor(minutes / 60);
  
  const emoji = isCritical ? '🚨' : '⚠️';
  const level = isCritical ? 'CRITICAL' : 'WARNING';
  
  let message = `${emoji} <b>DROPLET ${level}</b> ${emoji}\n`;
  message += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  if (hours > 0) {
    message += `⏱ <b>Offline for:</b> ${hours}h ${minutes % 60}m\n`;
  } else {
    message += `⏱ <b>Offline for:</b> ${minutes}m\n`;
  }
  
  message += '\n<b>Action Required:</b>\n';
  message += 'SSH to droplet and restart:\n';
  message += '<code>pm2 restart bot.mjs</code>\n\n';
  message += 'Or check server status:\n';
  message += '<code>systemctl status arb-bot</code>\n\n';
  
  if (isCritical) {
    message += '🔴 <b>No trades are being executed!</b>\n';
    message += 'Markets are being missed.\n\n';
  }
  
  message += `<i>Alert time: ${new Date().toLocaleTimeString()}</i>`;
  
  return message;
}

function formatRecoveryAlert(downtimeSec) {
  const minutes = Math.floor(downtimeSec / 60);
  const hours = Math.floor(minutes / 60);
  
  let message = '✅ <b>DROPLET RECOVERED</b> ✅\n';
  message += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  message += '🟢 Droplet is back online\n';
  
  if (hours > 0) {
    message += `⏱ <b>Downtime:</b> ${hours}h ${minutes % 60}m\n`;
  } else {
    message += `⏱ <b>Downtime:</b> ${minutes}m\n`;
  }
  
  message += `🕐 <b>Recovered at:</b> ${new Date().toLocaleTimeString()}\n\n`;
  message += '<i>Monitoring resumed. Next check in 60s.</i>';
  
  return message;
}

async function checkAndAlert(base44) {
  const now = Date.now();
  
  // Get latest heartbeat
  const heartbeats = await base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 5);
  const lastHb = heartbeats[0];
  
  if (!lastHb) {
    return { status: 'no_data', alertSent: false };
  }
  
  const lastHeartbeatTime = new Date(lastHb.snapshot_time).getTime();
  const offlineSec = Math.floor((now - lastHeartbeatTime) / 1000);
  
  // Determine current status
  let currentStatus = 'healthy';
  if (offlineSec >= CRITICAL_THRESHOLD_SEC) {
    currentStatus = 'critical';
  } else if (offlineSec >= OFFLINE_THRESHOLD_SEC) {
    currentStatus = 'offline';
  }
  
  const result = {
    status: currentStatus,
    offlineSec,
    lastHeartbeat: lastHb.snapshot_time,
    alertSent: false,
    recoverySent: false,
  };
  
  // Check for recovery (was offline, now healthy)
  if ((lastStatus === 'offline' || lastStatus === 'critical') && currentStatus === 'healthy') {
    const downtime = offlineStartTime ? Math.floor((now - offlineStartTime) / 1000) : offlineSec;
    const recoveryMessage = formatRecoveryAlert(downtime);
    await sendTelegramAlert(recoveryMessage);
    
    result.recoverySent = true;
    offlineStartTime = null;
    
    await auditLog(base44, {
      eventType: 'DROPLET_RECOVERY_ALERT',
      severity: 'INFO',
      message: `Droplet recovered after ${downtime}s`,
      details: { downtime, previousStatus: lastStatus },
    });
  }
  
  // Check if we should send offline alert
  if (currentStatus === 'offline' || currentStatus === 'critical') {
    // Track when we first went offline
    if (!offlineStartTime) {
      offlineStartTime = now - (offlineSec * 1000);
    }
    
    // Check cooldown
    const timeSinceLastAlert = (now - lastAlertTime) / 1000;
    if (timeSinceLastAlert >= ALERT_COOLDOWN_SEC) {
      const isCritical = currentStatus === 'critical';
      const alertMessage = formatOfflineAlert(offlineSec, isCritical);
      const alertResult = await sendTelegramAlert(alertMessage);
      
      if (alertResult.sent) {
        lastAlertTime = now;
        result.alertSent = true;
        
        await auditLog(base44, {
          eventType: 'DROPLET_OFFLINE_ALERT',
          severity: isCritical ? 'CRITICAL' : 'WARNING',
          message: `Droplet ${currentStatus} for ${offlineSec}s`,
          details: { offlineSec, status: currentStatus },
        });
      }
    }
  }
  
  lastStatus = currentStatus;
  return result;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const result = await checkAndAlert(base44);
    
    return Response.json({
      ok: true,
      checked_at: new Date().toISOString(),
      ...result,
    });
    
  } catch (error) {
    console.error('[CriticalAlert] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
