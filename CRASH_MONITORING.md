# Droplet Crash Monitoring & Auto-Recovery

## Problem
Your droplet keeps crashing. This system monitors, detects, and auto-recovers from crashes.

## Crash Detection

The system detects crashes by monitoring:
- **No heartbeat** for >5 minutes
- **High memory** (>450MB on 512MB server)
- **High CPU** (>90%)
- **WebSocket failures**
- **POST errors**

## Alert Types

### 💥 Crash Detected
```
💥 DROPLET CRASH DETECTED 💥
━━━━━━━━━━━━━━━━━━━━━

⏱ Offline for: 8m 30s
🔢 Crash count (24h): 3

Last known status:
• Memory: 485.2 MB
• CPU: 95.3%
• Evaluations: 1520
• Posted: 12

Possible causes:
1. High memory usage (485.2 MB / 512 MB limit)
2. WebSocket connections unstable

Auto-restart: Attempting...
```

### ✅ Auto-Restart Success
```
✅ DROPLET AUTO-RESTARTED ✅
━━━━━━━━━━━━━━━━━━━━━

🔄 Restart attempt: #2
⏱ Downtime: 8m 30s

Monitoring for stability...
```

### 🔴 Multiple Crashes
```
🔴 MULTIPLE CRASHES DETECTED 🔴
━━━━━━━━━━━━━━━━━━━━━

💥 Crashes in last 24h: 5

Recommended actions:
1. Check memory usage - may need upgrade
2. Review logs for errors
3. Consider reducing scan frequency
4. Check for memory leaks in bot.mjs

journalctl -u arb-bot -f
```

## Setup

### 1. Schedule the Monitor
```json
{
  "scheduled_functions": [
    {
      "function": "crashMonitor",
      "schedule": "* * * * *",
      "description": "Monitor for crashes every minute"
    }
  ]
}
```

### 2. Configure Telegram Alerts
Set environment variables:
```bash
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_chat_id
```

### 3. Enable Auto-Restart (Optional)

For true auto-restart, add webhook to your droplet:

```bash
# On droplet, create restart endpoint
# /opt/arb-bot/restart.sh
#!/bin/bash
systemctl restart arb-bot
echo "Restarted at $(date)"
```

Then configure the function to call this endpoint.

## Common Crash Causes & Fixes

| Cause | Symptom | Fix |
|-------|---------|-----|
| **Out of Memory** | Memory >450MB | Reduce scan frequency, restart every 4h |
| **Memory Leak** | Memory grows over time | Restart every 6h via cron |
| **WebSocket Drop** | Stale books | Auto-reconnect logic in bot |
| **High CPU** | CPU >90% | Reduce concurrent scans |
| **Network Issues** | POST errors | Check DNS, use retry logic |

## Manual Commands

Check bot status:
```bash
systemctl status arb-bot
```

View logs:
```bash
journalctl -u arb-bot -f
```

Check memory:
```bash
ps aux | grep node
free -m
```

Restart manually:
```bash
systemctl restart arb-bot
```

## Monitoring Dashboard

View crash history in the app:
1. Go to **Droplet Health** page
2. Check **Crash Log** section
3. See patterns and causes

## Prevention Tips

1. **Schedule Regular Restarts**
   ```bash
   # Add to crontab
   0 */4 * * * systemctl restart arb-bot
   ```

2. **Monitor Memory**
   - Alert if >400MB
   - Restart if >450MB

3. **Reduce Load**
   - Scan fewer pairs
   - Increase scan interval
   - Reduce concurrent connections

4. **Upgrade Server**
   - Current: 512MB RAM
   - Recommended: 1GB RAM for stability

## Auto-Recovery Flow

```
Crash Detected
    ↓
Analyze Cause
    ↓
Send Alert
    ↓
Attempt Restart (max 3)
    ↓
Verify Recovery
    ↓
Send Recovery Alert
    ↓
Continue Monitoring
```

## Expected Downtime

With auto-restart: **~30-60 seconds**
Without auto-restart: **Until manual intervention**

## Support

If crashes continue:
1. Check logs: `journalctl -u arb-bot -n 500`
2. Monitor memory: `watch -n 1 free -m`
3. Consider upgrading to 1GB RAM server
