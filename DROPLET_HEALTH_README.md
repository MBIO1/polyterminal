# Droplet Health Check System - Implementation Summary

## Overview
A comprehensive droplet health monitoring system has been implemented to check if the arbitrage bot is running properly.

## New Components

### 1. Backend Function: `dropletHealth/entry.ts`
**Purpose**: Comprehensive diagnostic endpoint for droplet health

**Checks Performed**:
- **Heartbeat Recency**: Last heartbeat within 3 minutes (critical) or 2 minutes (warning)
- **Signal Flow**: Detects if signals are being posted but not ingested
- **Connectivity**: Tracks POST errors and non-2xx responses
- **WebSocket Freshness**: Order book freshness from exchanges
- **Evaluation Rate**: Ensures bot is actively evaluating markets

**Health Thresholds**:
```typescript
heartbeat_max_age_sec: 180        // 3 minutes - critical
heartbeat_warning_age_sec: 120    // 2 minutes - warning
max_post_errors_per_hour: 5
max_non_2xx_per_hour: 10
min_evaluations_per_hour: 100
min_signals_per_hour: 1
```

**Response Structure**:
```json
{
  "overall_status": "healthy|warning|critical",
  "heartbeat": {
    "status": "healthy",
    "last_seen_sec": 45,
    "heartbeats_last_hour": 60,
    "total_evaluations_last_hour": 15000
  },
  "connectivity": {
    "post_errors_last_hour": 0,
    "non_2xx_last_hour": 0
  },
  "signal_flow": {
    "status": "flowing",
    "signals_ingested_last_hour": 5
  },
  "websocket_books": {
    "status": "healthy",
    "details": "28/28 books fresh (100%)"
  },
  "recommendations": [...]
}
```

### 2. Frontend Page: `DropletHealthCheck.jsx`
**Purpose**: Visual dashboard for monitoring droplet health

**Features**:
- Real-time health status with color-coded indicators
- Auto-refresh every 60 seconds
- Detailed breakdown of heartbeat, connectivity, and signal flow
- WebSocket book freshness visualization
- Actionable recommendations with priority levels (P0, P1, P2)
- Latest diagnostics from the most recent heartbeat

### 3. Enhanced `ingestHeartbeat/entry.ts`
**Security Improvements**:
- Rate limiting (60 req/min per IP)
- Input validation and sanitization
- Suspicious input detection
- Audit logging for heartbeats with errors
- Request ID tracking

### 4. Updated Sidebar
Added "Droplet Health" navigation item with HeartPulse icon

## How to Use

### Check Droplet Health
1. Navigate to **Droplet Health** in the sidebar
2. View the overall status card (green/yellow/red)
3. Check individual components:
   - **Heartbeat**: Should show "healthy" with last seen < 180s
   - **Connectivity**: POST errors and non-2xx should be 0
   - **Signal Flow**: Should show "flowing" with recent signals
   - **WebSocket Books**: Should show "healthy" with >90% fresh
4. Review recommendations if any issues are detected

### Common Issues & Solutions

#### "No heartbeats received ever"
- **Cause**: Droplet bot is not running
- **Solution**: SSH to droplet and run `pm2 start bot.mjs`

#### "POST errors in last hour"
- **Cause**: Network/DNS issues on droplet
- **Solution**: Check droplet internet connectivity

#### "Non-2xx responses from ingestSignal"
- **Cause**: Function errors
- **Solution**: Check Base44 function logs

#### "Some order books are stale"
- **Cause**: WebSocket disconnections
- **Solution**: Check exchange WebSocket connections on droplet

## API Usage

### Manual Health Check
```bash
curl -X POST https://your-app.base44.app/functions/dropletHealth \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Response Example (Healthy)
```json
{
  "ok": true,
  "overall_status": "healthy",
  "heartbeat": {
    "status": "healthy",
    "last_seen_sec": 45,
    "heartbeats_last_hour": 60
  },
  "signal_flow": {
    "status": "flowing",
    "signals_ingested_last_hour": 5
  },
  "recommendations": []
}
```

### Response Example (Critical)
```json
{
  "ok": true,
  "overall_status": "critical",
  "heartbeat": {
    "status": "critical",
    "last_seen_sec": 300,
    "issues": ["Last heartbeat 300s ago (threshold: 180s)"]
  },
  "recommendations": [
    {
      "priority": "P0",
      "action": "Start the droplet bot",
      "details": "The bot.mjs process is not running. SSH to droplet and run: pm2 start bot.mjs"
    }
  ]
}
```

## Integration with Existing System

The health check integrates with:
- **ArbHeartbeat entity**: Reads heartbeat data
- **ArbSignal entity**: Checks signal ingestion
- **Audit logging**: Logs health check results
- **Rate limiting**: Prevents abuse of health endpoint

## Monitoring Best Practices

1. **Check Regularly**: Visit Droplet Health page daily
2. **Set Up Alerts**: Use the audit logs to trigger external alerts
3. **Review Trends**: Watch for gradual degradation in evaluation rates
4. **Act on P0**: Immediately address any P0 recommendations

## Files Modified/Created

### New Files
- `base44/functions/dropletHealth/entry.ts`
- `src/pages/DropletHealthCheck.jsx`

### Modified Files
- `base44/functions/ingestHeartbeat/entry.ts` (security enhancements)
- `src/App.jsx` (added route)
- `src/components/layout/Sidebar.jsx` (added navigation)
