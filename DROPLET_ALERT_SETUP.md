# Droplet Health Alert - Scheduled Job Setup

## Overview
The `dropletHealthAlert` function monitors the droplet bot health and sends Telegram alerts when issues are detected.

## Alert Types

### 1. 🔴 Critical - Droplet Offline
**Trigger**: No heartbeat for > 10 minutes  
**Cooldown**: 5 minutes  
**Message Format**:
```
🔴 DROPLET OFFLINE - CRITICAL
━━━━━━━━━━━━━━━━━━━━━

⏱ Missing for: Xh Xm

Detected Issues:
1. No heartbeat for X minutes

Action Required:
SSH to droplet and restart:
pm2 restart bot.mjs
or
systemctl restart arb-bot

This alert will repeat every 5 minutes until resolved.
```

### 2. 🟡 Warning - Stale Heartbeat
**Trigger**: Heartbeat > 3 minutes old  
**Cooldown**: 5 minutes  
**Includes**: Last known market data, book freshness

### 3. 🟡 WebSocket Books Degraded
**Trigger**: Book freshness < 70%  
**Cooldown**: 5 minutes  
**Includes**: List of stale venues

### 4. 🔴 Connectivity Issues
**Trigger**: >= 3 POST errors or >= 5 non-2xx responses in 1 hour  
**Cooldown**: 5 minutes

### 5. 🟢 Recovery Alert
**Trigger**: Droplet comes back online after being offline  
**Includes**: Downtime duration

## Setup Instructions

### 1. Environment Variables
Ensure these are set:
```bash
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### 2. Schedule the Function

#### Option A: Base44 Scheduled Jobs (Recommended)
Add to your Base44 app configuration:
```json
{
  "scheduled_functions": [
    {
      "function": "dropletHealthAlert",
      "schedule": "* * * * *",
      "description": "Check droplet health every minute"
    }
  ]
}
```

#### Option B: External Cron Service
Use a service like cron-job.org or your own server:
```bash
curl -X POST https://your-app.base44.app/functions/dropletHealthAlert \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Option C: Droplet Self-Monitoring
Add to your bot.mjs to call the health check endpoint every minute:
```javascript
setInterval(async () => {
  await fetch('https://your-app.base44.app/functions/dropletHealthAlert', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
}, 60000);
```

### 3. Manual Testing
Test the alert system:
```bash
curl -X POST https://your-app.base44.app/functions/dropletHealthAlert \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Telegram Bot Setup

1. Create a bot with @BotFather
2. Get your chat ID by messaging @userinfobot
3. Set environment variables in Base44

## Alert Cooldown Logic

To prevent spam:
- Same alert type won't repeat within 5 minutes
- Critical alerts continue until resolved
- Recovery alert sent when condition clears

## Monitoring the Monitor

The function logs all checks to `ArbAuditLog` with:
- Event type: `DROPLET_HEALTH_CHECK`
- Severity: INFO/WARN/CRITICAL
- Details: status, heartbeat age, issues detected

## Troubleshooting

### Alerts not sending
- Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
- Verify bot has permission to send messages
- Check function logs in Base44

### False positives
- Adjust thresholds in the function:
  - `HEARTBEAT_STALE_SEC` (default: 180)
  - `HEARTBEAT_CRITICAL_SEC` (default: 600)
  - `MIN_BOOK_FRESHNESS_PCT` (default: 70)

### Too many alerts
- Increase `ALERT_COOLDOWN_MS` (default: 5 minutes)
- Or adjust sensitivity thresholds
