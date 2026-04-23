// Droplet Health Monitor - Telegram Alerts
// 
// Monitors droplet heartbeat and sends Telegram alerts when:
// - Heartbeat is stale (> 3 minutes)
// - WebSocket books are stale
// - POST errors detected
// - Bot is not running
//
// Can be triggered by:
// 1. Scheduled cron job (every minute)
// 2. Manual invocation
// 3. Webhook from monitoring service

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { auditLog } from '../lib/auditLogger.ts';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

// Health thresholds
const HEARTBEAT_STALE_SEC = 180; // 3 minutes
const HEARTBEAT_CRITICAL_SEC = 600; // 10 minutes
const MAX_POST_ERRORS = 3;
const MAX_NON_2XX = 5;
const MIN_BOOK_FRESHNESS_PCT = 70;

// Alert cooldown to prevent spam (ms)
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const lastAlertTime = new Map();

async function sendTelegramAlert(text, parseMode = 'HTML') {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[DropletAlert] Telegram not configured, skipping alert');
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[DropletAlert] Telegram send failed:', res.status, err);
      return { sent: false, error: err };
    }

    return { sent: true };
  } catch (e) {
    console.error('[DropletAlert] Telegram send error:', e.message);
    return { sent: false, error: e.message };
  }
}

function shouldSendAlert(alertType) {
  const lastSent = lastAlertTime.get(alertType) || 0;
  const now = Date.now();
  
  if (now - lastSent < ALERT_COOLDOWN_MS) {
    return false; // Still in cooldown
  }
  
  lastAlertTime.set(alertType, now);
  return true;
}

function formatHealthBadge(status, ageSec, diagnostics) {
  const emoji = status === 'healthy' ? '🟢' : status === 'warning' ? '🟡' : '🔴';
  const statusText = status.toUpperCase();
  
  let message = `${emoji} <b>DROPLET ${statusText}</b>\n`;
  message += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  // Heartbeat info
  const ageMin = Math.floor(ageSec / 60);
  const ageHours = Math.floor(ageSec / 3600);
  
  if (ageSec < 60) {
    message += `⏱ <b>Last Heartbeat:</b> ${ageSec}s ago\n`;
  } else if (ageSec < 3600) {
    message += `⏱ <b>Last Heartbeat:</b> ${ageMin}m ago\n`;
  } else {
    message += `⏱ <b>Last Heartbeat:</b> ${ageHours}h ${ageMin % 60}m ago\n`;
  }
  
  // Market conditions from last heartbeat
  if (diagnostics) {
    message += `\n📊 <b>Last Known Market:</b>\n`;
    message += `• Best Edge: ${diagnostics.best_edge_bps?.toFixed(2) || 'N/A'} bps\n`;
    message += `• Pair: ${diagnostics.best_edge_pair || 'N/A'}\n`;
    
    // Book freshness
    if (diagnostics.fresh_books) {
      const venues = diagnostics.fresh_books.split(' ').filter(Boolean);
      const freshCount = venues.reduce((acc, v) => {
        const match = v.match(/:(\d+)\/(\d+)/);
        return acc + (match ? parseInt(match[1]) : 0);
      }, 0);
      const totalCount = venues.reduce((acc, v) => {
        const match = v.match(/:(\d+)\/(\d+)/);
        return acc + (match ? parseInt(match[2]) : 0);
      }, 0);
      const freshnessPct = totalCount > 0 ? (freshCount / totalCount) * 100 : 0;
      
      message += `• Book Freshness: ${freshnessPct.toFixed(0)}% (${freshCount}/${totalCount})\n`;
    }
    
    // Evaluations and signals
    message += `• Recent Evaluations: ${diagnostics.evaluations || 0}\n`;
    message += `• Signals Posted: ${diagnostics.posted || 0}\n`;
  }
  
  return message;
}

function formatCriticalAlert(ageSec, issues) {
  let message = '🔴 <b>DROPLET OFFLINE - CRITICAL</b>\n';
  message += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  const ageHours = Math.floor(ageSec / 3600);
  const ageMin = Math.floor((ageSec % 3600) / 60);
  
  message += `⏱ <b>Missing for:</b> ${ageHours}h ${ageMin}m\n\n`;
  
  message += '<b>Detected Issues:</b>\n';
  issues.forEach((issue, i) => {
    message += `${i + 1}. ${issue}\n`;
  });
  
  message += '\n<b>Action Required:</b>\n';
  message += 'SSH to droplet and restart:\n';
  message += '<code>pm2 restart bot.mjs</code>\n';
  message += 'or\n';
  message += '<code>systemctl restart arb-bot</code>\n';
  
  message += '\n<i>This alert will repeat every 5 minutes until resolved.</i>';
  
  return message;
}

function formatRecoveryAlert(lastDowntimeSec) {
  const downtimeMin = Math.floor(lastDowntimeSec / 60);
  
  let message = '🟢 <b>DROPLET RECOVERED</b>\n';
  message += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  message += `✅ Droplet is back online\n`;
  message += `⏱ Downtime: ${downtimeMin} minutes\n`;
  message += `🕐 Recovered at: ${new Date().toLocaleTimeString()}\n`;
  
  return message;
}

function formatBookFreshnessAlert(freshnessPct, staleVenues) {
  let message = '🟡 <b>WEBSOCKET BOOKS DEGRADED</b>\n';
  message += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  message += `📊 Freshness: ${freshnessPct.toFixed(0)}% (below ${MIN_BOOK_FRESHNESS_PCT}%)\n\n`;
  
  if (staleVenues.length > 0) {
    message += '<b>Stale Venues:</b>\n';
    staleVenues.forEach(v => {
      message += `• ${v}\n`;
    });
  }
  
  message += '\n<i>May indicate WebSocket connection issues.</i>';
  
  return message;
}

function formatConnectivityAlert(postErrors, non2xx) {
  let message = '🔴 <b>CONNECTIVITY ISSUES</b>\n';
  message += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  if (postErrors > 0) {
    message += `❌ POST Errors: ${postErrors}\n`;
    message += '   (Network/DNS issues)\n';
  }
  
  if (non2xx > 0) {
    message += `⚠️ Non-2xx Responses: ${non2xx}\n`;
    message += '   (Server errors)\n';
  }
  
  message += '\n<i>Check droplet network connectivity.</i>';
  
  return message;
}

async function checkAndAlert(base44) {
  const now = Date.now();
  const alerts = [];
  
  // Get latest heartbeat
  const heartbeats = await base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 5);
  const lastHb = heartbeats[0];
  
  // Get recent signals
  const recentSignals = await base44.asServiceRole.entities.ArbSignal.list('-received_time', 10);
  const signalsLastHour = recentSignals.filter(s => {
    const ts = new Date(s.received_time || s.created_date).getTime();
    return now - ts < 3600000;
  });
  
  // Calculate heartbeat age
  let heartbeatAgeSec = Infinity;
  if (lastHb) {
    heartbeatAgeSec = Math.floor((now - new Date(lastHb.snapshot_time).getTime()) / 1000);
  }
  
  // Determine status
  let status = 'healthy';
  const issues = [];
  
  if (heartbeatAgeSec > HEARTBEAT_CRITICAL_SEC) {
    status = 'critical';
    issues.push(`No heartbeat for ${Math.floor(heartbeatAgeSec / 60)} minutes`);
  } else if (heartbeatAgeSec > HEARTBEAT_STALE_SEC) {
    status = 'warning';
    issues.push(`Stale heartbeat (${Math.floor(heartbeatAgeSec / 60)}m old)`);
  }
  
  // Check book freshness
  let bookFreshnessPct = 100;
  const staleVenues = [];
  
  if (lastHb?.fresh_books) {
    const venues = lastHb.fresh_books.split(' ').filter(Boolean);
    let totalFresh = 0;
    let totalExpected = 0;
    
    venues.forEach(v => {
      const match = v.match(/(.+):(\d+)\/(\d+)/);
      if (match) {
        const [, name, fresh, total] = match;
        totalFresh += parseInt(fresh);
        totalExpected += parseInt(total);
        if (parseInt(fresh) < parseInt(total)) {
          staleVenues.push(name);
        }
      }
    });
    
    bookFreshnessPct = totalExpected > 0 ? (totalFresh / totalExpected) * 100 : 100;
    
    if (bookFreshnessPct < MIN_BOOK_FRESHNESS_PCT) {
      issues.push(`Low book freshness: ${bookFreshnessPct.toFixed(0)}%`);
    }
  }
  
  // Check for errors in recent heartbeats
  let postErrorsLastHour = 0;
  let non2xxLastHour = 0;
  
  heartbeats.forEach(hb => {
    const hbTime = new Date(hb.snapshot_time).getTime();
    if (now - hbTime < 3600000) {
      postErrorsLastHour += Number(hb.post_errors || 0);
      non2xxLastHour += Number(hb.post_non_2xx || 0);
    }
  });
  
  if (postErrorsLastHour >= MAX_POST_ERRORS) {
    issues.push(`${postErrorsLastHour} POST errors in last hour`);
  }
  
  if (non2xxLastHour >= MAX_NON_2XX) {
    issues.push(`${non2xxLastHour} non-2xx responses in last hour`);
  }
  
  // Send appropriate alerts
  
  // 1. Critical - Droplet offline
  if (status === 'critical' && shouldSendAlert('critical_offline')) {
    const alertText = formatCriticalAlert(heartbeatAgeSec, issues);
    const result = await sendTelegramAlert(alertText);
    alerts.push({ type: 'critical_offline', sent: result.sent });
  }
  
  // 2. Warning - Stale heartbeat
  else if (status === 'warning' && shouldSendAlert('warning_stale')) {
    const alertText = formatHealthBadge(status, heartbeatAgeSec, lastHb);
    const result = await sendTelegramAlert(alertText);
    alerts.push({ type: 'warning_stale', sent: result.sent });
  }
  
  // 3. Book freshness issues
  if (bookFreshnessPct < MIN_BOOK_FRESHNESS_PCT && shouldSendAlert('book_freshness')) {
    const alertText = formatBookFreshnessAlert(bookFreshnessPct, staleVenues);
    const result = await sendTelegramAlert(alertText);
    alerts.push({ type: 'book_freshness', sent: result.sent });
  }
  
  // 4. Connectivity issues
  if ((postErrorsLastHour >= MAX_POST_ERRORS || non2xxLastHour >= MAX_NON_2XX) && 
      shouldSendAlert('connectivity')) {
    const alertText = formatConnectivityAlert(postErrorsLastHour, non2xxLastHour);
    const result = await sendTelegramAlert(alertText);
    alerts.push({ type: 'connectivity', sent: result.sent });
  }
  
  // Log the check
  await auditLog(base44, {
    eventType: 'DROPLET_HEALTH_CHECK',
    severity: status === 'critical' ? 'CRITICAL' : status === 'warning' ? 'WARN' : 'INFO',
    message: `Droplet health check: ${status}`,
    details: {
      status,
      heartbeatAgeSec,
      bookFreshnessPct,
      postErrorsLastHour,
      non2xxLastHour,
      issues,
      alertsSent: alerts.filter(a => a.sent).length,
    },
  });
  
  return {
    status,
    heartbeatAgeSec,
    bookFreshnessPct,
    issues,
    alerts,
    lastHeartbeat: lastHb?.snapshot_time,
    signalsLastHour: signalsLastHour.length,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Optional: Check auth for manual triggers
    const user = await base44.auth.me();
    
    const result = await checkAndAlert(base44);
    
    return Response.json({
      ok: true,
      checked_at: new Date().toISOString(),
      ...result,
    });
    
  } catch (error) {
    console.error('dropletHealthAlert error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
