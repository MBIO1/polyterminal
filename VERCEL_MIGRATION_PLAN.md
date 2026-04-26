# Backend Migration: Base44 → Vercel

## Overview
Moving all backend functions from Base44 to Vercel serverless functions.

## Architecture Changes

### Current (Base44)
- Frontend: React app hosted on Base44
- Backend: Base44 serverless functions (Deno runtime)
- Database: Base44 entities (PostgreSQL)

### Target (Vercel)
- Frontend: React app on Vercel (✅ Done)
- Backend: Vercel serverless functions (Node.js runtime)
- Database: Need to migrate to external DB (Supabase/PostgreSQL)

## Functions to Migrate

### Core Functions (Priority 1)
1. ✅ `ingestHeartbeat` - Store droplet heartbeats
2. ✅ `ingestSignal` - Store arbitrage signals  
3. ✅ `executeSignals` - Execute trades
4. ✅ `dropletHealth` - Health check endpoint
5. ✅ `okxMarketScan` - Market data scanning

### Supporting Functions (Priority 2)
6. `botProductivity` - Analytics
7. `signalStats` - Signal statistics
8. `systemAudit` - System health audit
9. `scanFunding` - Funding rate scanning
10. `telegramWebhook` - Telegram bot

### Management Functions (Priority 3)
11. `arbMonitor` - Monitoring
12. `recordScanSnapshot` - Data recording
13. `refreshOpenPositionMarks` - Position updates

## Database Migration

### Option A: Supabase (Recommended)
- PostgreSQL database
- Real-time subscriptions
- Auth included
- Free tier available

### Option B: MongoDB Atlas
- Document-based
- Good for JSON data
- Free tier available

### Option C: Vercel Postgres (Beta)
- Native Vercel integration
- Serverless PostgreSQL
- Paid service

## Implementation Plan

### Phase 1: Database Setup (Day 1)
1. Create Supabase project
2. Set up database schema
3. Migrate existing data from Base44

### Phase 2: Core Functions (Day 2-3)
1. Set up Vercel API routes (`/api/*`)
2. Migrate ingestHeartbeat
3. Migrate ingestSignal
4. Migrate executeSignals
5. Test end-to-end flow

### Phase 3: Supporting Functions (Day 4-5)
1. Migrate analytics functions
2. Migrate monitoring functions
3. Set up scheduled jobs (Vercel Cron)

### Phase 4: Testing & Cleanup (Day 6-7)
1. Full system testing
2. Performance optimization
3. Documentation update

## File Structure

```
/api
  /heartbeat
    POST.js          # ingestHeartbeat
    GET.js           # getHeartbeats
  /signals
    POST.js          # ingestSignal
    GET.js           # getSignals
    /execute
      POST.js        # executeSignals
  /health
    GET.js           # dropletHealth
  /market
    GET.js           # okxMarketScan
  /trades
    GET.js           # getTrades
    POST.js          # createTrade
  /config
    GET.js           # getConfig
    PUT.js           # updateConfig
```

## Environment Variables Needed

```bash
# Database
DATABASE_URL=postgresql://...
SUPABASE_URL=https://...
SUPABASE_KEY=...

# Exchange APIs
BYBIT_API_KEY=...
BYBIT_API_SECRET=...
OKX_API_KEY=...
OKX_API_SECRET=...
OKX_PASSPHRASE=...

# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Secrets
JWT_SECRET=...
ENCRYPTION_KEY=...
```

## Cost Estimate

| Service | Cost |
|---------|------|
| Vercel Pro | $20/month |
| Supabase | Free tier |
| Total | ~$20/month |

## Next Steps

1. **Set up Supabase database**
2. **Create first API route** (heartbeat)
3. **Test data flow** from droplet → Vercel
4. **Migrate remaining functions**

Ready to start with Phase 1?
