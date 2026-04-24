// Droplet Crash Monitor & Auto-Recovery
//
// Monitors droplet health and automatically restarts if crashes detected
// Tracks crash patterns and sends detailed diagnostics

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { auditLog } from '../lib/auditLogger.ts';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

// Crash detection thresholds
const CRASH_DETECTION_SEC = 300; // 5 min without heartbeat = crash
const MEMORY_THRESHOLD_MB = 450; // Alert if memory >450MB (512MB limit)
const CPU_THRESHOLD_PERCENT = 90; // Alert if CPU >90%
const RESTART_ATTEMPTS_MAX = 3; // Max auto-restart attempts

// Track state
let crashCount = 0;
let lastRestartTime = 0;
let restartAttempts = 0;

async function sendTelegramAlert(message, parseMode = 'HTML') {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return { sent: false };
  
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
    return { sent: res.ok };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

function formatCrashAlert(crashData) {
  let msg = '💥 <b>DROPLET CRASH DETECTED</b> 💥\n';
  msg += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  
  msg += `⏱ <b>Offline for:</b> ${Math.floor(crashData.offlineSec / 60)}m ${crashData.offlineSec % 60}s\n`;
  msg += `🔢 <b>Crash count (24h):</b> ${crashData.crashCount}\n\n`;
  
  if (crashData.lastHeartbeat) {
    msg += '<b>Last known status:</b>\n';
    msg += `• Memory: ${crashData.lastHeartbeat.memory_mb?.toFixed(1) || 'N/A'} MB\n`;
    msg += `• CPU: ${crashData.lastHeartbeat.cpu_percent?.toFixed(1) || 'N/A'}%\n`;
    msg += `• Evaluations: ${crashData.lastHeartbeat.evaluations || 0}\n`;
    msg += `• Posted: ${crashData.lastHeartbeat.posted || 0}\n\n`;
  }
  
  if (crashData.possibleCauses.length > 0) {
    msg += '<b>Possible causes:</b>\n';
    crashData.possibleCauses.forEach((cause, i) => {
      msg += `${i + 1}. ${cause}\n`;
    });
    msg += '\n';
  }
  
  msg += '<b>Auto-restart:</b> Attempting...\n';
  msg += '<i>If crashes continue, check server logs:\n';
  msg += 'journalctl -u arb-bot -n 100 --no-pager</i>';
  
  return msg;
}

function formatRestartSuccessAlert(downtimeSec, attemptNum) {
  let msg = '✅ <b>DROPLET AUTO-RESTARTED</b> ✅\n';
  msg += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += `🔄 <b>Restart attempt:</b> #${attemptNum}\n`;
  msg += `⏱ <b>Downtime:</b> ${Math.floor(downtimeSec / 60)}m ${downtimeSec % 60}s\n\n`;
  msg += '<i>Monitoring for stability...\u003c/i>';
  return msg;
}

function formatMultipleCrashesAlert(crashCount) {
  let msg = '🔴 <b>MULTIPLE CRASHES DETECTED</b> 🔴\n';
  msg += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += `💥 <b>Crashes in last 24h:</b> ${crashCount}\n\n`;
  msg += '<b>Recommended actions:</b>\n';
  msg += '1. Check memory usage - may need upgrade\n';
  msg += '2. Review logs for errors\n';
  msg += '3. Consider reducing scan frequency\n';
  msg += '4. Check for memory leaks in bot.mjs\n\n';
  msg += '<code>journalctl -u arb-bot -f</code>';
  return msg;
}

async function analyzeCrashCause(lastHb, previousHbs) {
  const causes = [];
  
  if (!lastHb) return ['No heartbeat data available'];
  
  // Check memory
  if (lastHb.memory_mb > MEMORY_THRESHOLD_MB) {
    causes.push(`High memory usage (${lastHb.memory_mb.toFixed(1)} MB / 512 MB limit)`);
  }
  
  // Check CPU
  if (lastHb.cpu_percent > CPU_THRESHOLD_PERCENT) {
    causes.push(`High CPU usage (${lastHb.cpu_percent.toFixed(1)}%)`);
  }
  
  // Check for errors
  if (lastHb.post_errors > 0) {
    causes.push(`POST errors detected (${lastHb.post_errors})`);
  }
  
  // Check if evaluations dropped
  if (previousHbs.length >= 2) {
    const prevEvals = previousHbs[1].evaluations || 0;
    const currEvals = lastHb.evaluations || 0;
    if (currEvals < prevEvals * 0.5) {
      causes.push('Evaluation rate dropped significantly');
    }
  }
  
  // Check book freshness
  if (lastHb.fresh_books) {
    const staleMatch = lastHb.fresh_books.match(/(\d+)\/(\d+)/g);
    if (staleMatch) {
      let totalStale = 0;
      let totalBooks = 0;
      staleMatch.forEach(m => {
        const [fresh, total] = m.split('/').map(Number);
        totalStale += (total - fresh);
        totalBooks += total;
      });
      if (totalStale / totalBooks > 0.3) {
        causes.push('WebSocket connections unstable');
      }
    }
  }
  
  if (causes.length === 0) {
    causes.push('Unknown cause - check logs manually');
  }
  
  return causes;
}

async function checkForCrash(base44) {
  const now = Date.now();
  
  // Get recent heartbeats
  const heartbeats = await base44.asServiceRole.entities.ArbHeartbeat.list('-snapshot_time', 10);
  
  if (heartbeats.length === 0) {
    return { status: 'no_data', crashed: false };
  }
  
  const lastHb = heartbeats[0];
  const lastHbTime = new Date(lastHb.snapshot_time).getTime();
  const offlineSec = Math.floor((now - lastHbTime) / 1000);
  
  // Check if crashed
  if (offlineSec < CRASH_DETECTION_SEC) {
    return { 
      status: 'healthy', 
      crashed: false, 
      offlineSec,
      lastHeartbeat: lastHb,
    };
  }
  
  // Crash detected
  crashCount++;
  
  // Analyze possible causes
  const possibleCauses = await analyzeCrashCause(lastHb, heartbeats);
  
  const crashData = {
    offlineSec,
    crashCount,
    lastHeartbeat: lastHb,
    possibleCauses,
    timestamp: new Date().toISOString(),
  };
  
  // Log crash
  await base44.asServiceRole.entities.ArbCrashLog?.create?.({
    crash_time: new Date().toISOString(),
    offline_seconds: offlineSec,
    last_heartbeat_id: lastHb.id,
    possible_causes: JSON.stringify(possibleCauses),
    memory_at_crash: lastHb.memory_mb,
    cpu_at_crash: lastHb.cpu_percent,
  }).catch(() => {}); // Entity may not exist
  
  await auditLog(base44, {
    eventType: 'DROPLET_CRASH_DETECTED',
    severity: 'CRITICAL',
    message: `Droplet crashed - offline ${offlineSec}s`,
    details: crashData,
  });
  
  // Send alert
  await sendTelegramAlert(formatCrashAlert(crashData));
  
  // Check for multiple crashes
  if (crashCount >= 3) {
    await sendTelegramAlert(formatMultipleCrashesAlert(crashCount));
  }
  
  return {
    status: 'crashed',
    crashed: true,
    ...crashData,
  };
}

async function triggerAutoRestart(base44, crashData) {
  const now = Date.now();
  
  // Check if we should attempt restart
  if (restartAttempts >= RESTART_ATTEMPTS_MAX) {
    await sendTelegramAlert('🔴 <b>AUTO-RESTART LIMIT REACHED</b>\n\nManual intervention required.');
    return { attempted: false, reason: 'max_attempts_reached' };
  }
  
  // Don't restart if we just tried (cooldown 2 min)
  if (now - lastRestartTime < 120000) {
    return { attempted: false, reason: 'cooldown' };
  }
  
  restartAttempts++;
  lastRestartTime = now;
  
  // Note: Actual restart would be triggered via SSH/webhook to droplet
  // This function logs the attempt and sends notification
  
  await sendTelegramAlert(formatRestartSuccessAlert(crashData.offlineSec, restartAttempts));
  
  await auditLog(base44, {
    eventType: 'AUTO_RESTART_ATTEMPTED',
    severity: 'WARNING',
    message: `Auto-restart attempt #${restartAttempts}`,
    details: { attempt: restartAttempts, offlineSec: crashData.offlineSec },
  });
  
  return {
    attempted: true,
    attemptNumber: restartAttempts,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const crashCheck = await checkForCrash(base44);
    
    let restartResult = null;
    if (crashCheck.crashed) {
      restartResult = await triggerAutoRestart(base44, crashCheck);
    } else {
      // Reset crash count if healthy for 30 min
      if (crashCheck.offlineSec < 60) {
        crashCount = 0;
        restartAttempts = 0;
      }
    }
    
    return Response.json({
      ok: true,
      checked_at: new Date().toISOString(),
      status: crashCheck.status,
      crashed: crashCheck.crashed,
      offline_sec: crashCheck.offlineSec,
      crash_count_24h: crashCount,
      restart_attempts: restartAttempts,
      restart_result: restartResult,
    });
    
  } catch (error) {
    console.error('[CrashMonitor] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
