# Automated Droplet Alert System - Setup Guide

## Overview
This system automatically monitors your droplet and sends Telegram alerts when:
- Droplet goes offline for >3 minutes
- Droplet is critical (offline >10 minutes)
- Droplet recovers after being down

## Alert Schedule

| Function | Schedule | Purpose |
|----------|----------|---------|
| `criticalAlert` | Every 1 minute | Check droplet status and alert |
| `dropletHealthAlert` | Every 1 minute | Detailed health monitoring |
| `portfolioManager` | Every 6 hours | Rebalancing and compounding |

## Setup Instructions

### 1. Configure Environment Variables

In your Base44 app settings, add:
```bash
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_CHAT_ID=your_chat_id
```

### 2. Get Your Chat ID

1. Message @userinfobot on Telegram
2. It will reply with your user ID (that's your chat ID)
3. Or create a group, add @getidsbot, and get the group ID

### 3. Schedule the Functions

Add to your Base44 app configuration:
```json
{
  "scheduled_functions": [
    {
      "function": "criticalAlert",
      "schedule": "* * * * *",
      "description": "Check droplet every minute, alert if offline"
    },
    {
      "function": "dropletHealthAlert", 
      "schedule": "* * * * *",
      "description": "Detailed health monitoring"
    },
    {
      "function": "portfolioManager",
      "schedule": "0 */6 * * *",
      "description": "Rebalance and compound every 6 hours"
    }
  ]
}
```

### 4. Test the Alerts

1. Stop your droplet bot temporarily
2. Wait 3-5 minutes
3. You should receive a Telegram alert
4. Start the bot again
5. You should receive a recovery alert

## Alert Types

### 🔴 Critical Alert (Offline >10 min)
```
🚨 DROPLET CRITICAL 🚨
━━━━━━━━━━━━━━━━━━━━━

⏱ Offline for: 15m

Action Required:
SSH to droplet and restart:
pm2 restart bot.mjs

Or check server status:
systemctl status arb-bot

🔴 No trades are being executed!
Markets are being missed.

Alert time: 2:45:10 PM
```

### ⚠️ Warning Alert (Offline >3 min)
```
⚠️ DROPLET WARNING ⚠️
━━━━━━━━━━━━━━━━━━━━━

⏱ Offline for: 5m

Action Required:
SSH to droplet and restart:
pm2 restart bot.mjs

Alert time: 2:35:10 PM
```

### ✅ Recovery Alert
```
✅ DROPLET RECOVERED ✅
━━━━━━━━━━━━━━━━━━━━━

🟢 Droplet is back online
⏱ Downtime: 12m
🕐 Recovered at: 2:47:30 PM

Monitoring resumed. Next check in 60s.
```

## Troubleshooting

### Not receiving alerts?
1. Check TELEGRAM_BOT_TOKEN is correct
2. Verify TELEGRAM_CHAT_ID is correct (include - for groups)
3. Ensure bot has permission to send messages
4. Check function logs in Base44

### Too many alerts?
- Alerts have 5-minute cooldown
- Only get repeat alerts if still offline after 5 min
- Recovery alert sends immediately when back online

### Want to test?
```bash
# Manual test via API
curl -X POST https://your-app.base44.app/functions/criticalAlert \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Integration with Existing System

The alert system works alongside:
- **Droplet Health Check page**: Visual monitoring
- **Droplet Health Alert**: Detailed diagnostics
- **Critical Alert**: Immediate notifications

All three can run simultaneously for comprehensive monitoring.
