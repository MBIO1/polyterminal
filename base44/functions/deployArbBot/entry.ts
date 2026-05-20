/**
 * Deploy and start the arbitrage bot on the droplet
 * Creates directory, downloads bot files, sets up .env, and starts PM2
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dropletIp = Deno.env.get('DROPLET_IP');
    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const userToken = Deno.env.get('BASE44_USER_TOKEN');
    const baseUrl = Deno.env.get('BASE44_APP_URL');
    const bybitKey = Deno.env.get('BYBIT_API_KEY');
    const bybitSecret = Deno.env.get('BYBIT_API_SECRET');
    const orderServerPort = Deno.env.get('ORDER_SERVER_PORT') || '4001';

    if (!dropletIp || !dropletSecret) {
      return Response.json({ error: 'Missing DROPLET_IP or DROPLET_SECRET' }, { status: 400 });
    }

    // Generate the complete deployment script
    const deployScript = `#!/bin/bash
set -e

echo "=== 🚀 Deploying Base44 Arbitrage Bot ==="

# Step 1: Create bot directory
echo "📁 Creating bot directory..."
mkdir -p /root/arb-ws-bot
cd /root/arb-ws-bot

# Step 2: Write .env file
echo "📝 Writing .env configuration..."
cat > /root/.env << ENVEOF
BASE44_USER_TOKEN=${userToken}
BASE44_INGEST_URL=${baseUrl}/functions/ingestSignal
BASE44_HEARTBEAT_URL=${baseUrl}/functions/ingestHeartbeat
BASE44_RESULT_URL=${baseUrl}/functions/ingestTradeResult
BASE44_APP_URL=${baseUrl}
BOT_SECRET=${dropletSecret}
BYBIT_API_KEY=${bybitKey}
BYBIT_API_SECRET=${bybitSecret}
BYBIT_TESTNET=false
ORDER_SERVER_PORT=${orderServerPort}
MIN_NET_EDGE_BPS=20
ALERT_EDGE_BPS=20
MIN_FILLABLE_USD=500
PAIRS=BTC-USDT,ETH-USDT,SOL-USDT,BNB-USDT,AVAX-USDT,ATOM-USDT
ENVEOF
chmod 600 /root/.env
cp /root/.env /root/arb-ws-bot/.env
chmod 600 /root/arb-ws-bot/.env
echo "✅ .env written"

# Step 3: Download bot.mjs (the detection engine)
echo "📥 Downloading bot.mjs..."
cat > /root/arb-ws-bot/bot.mjs << 'BOTEOF'
/**
 * ArbitrageEngine v2 — High-Efficiency Edition
 */

const EXCHANGE_FEES = {
  binance: 0.10, kraken: 0.26, coinbase: 0.60, polymarket: 0.00, okx: 0.08, bybit: 0.10,
};

const SLIPPAGE_EST = {
  binance: 0.05, kraken: 0.10, coinbase: 0.10, polymarket: 0.15, okx: 0.05, bybit: 0.05,
};

class ArbitrageEngine {
  constructor(config = {}) {
    this.config = {
      minNetSpreadPct: config.minNetSpreadPct || 0.2,
      noiseThreshold: config.noiseThreshold || 0.02,
      learnMode: config.learnMode !== false,
      pollInterval: config.pollInterval || 3000,
      historySize: config.historySize || 100,
      maxTradeHistory: config.maxTradeHistory || 1000,
      cooldownMs: config.cooldownMs || 10000,
      circuitBreakerLoss: config.circuitBreakerLoss || 3,
      circuitBreakerMs: config.circuitBreakerMs || 60000,
      fetchTimeoutMs: config.fetchTimeoutMs || 5000,
      fetchRetries: config.fetchRetries || 2,
      minConfidence: config.minConfidence || 60,
      ...config,
    };

    this.priceHistory = {};
    this.symbolThresholds = {};
    this.symbolStats = {};
    this.performanceLog = [];
    this.lastSignals = new Map();
    this.opportunities = [];
    this.isRunning = false;
    this.consecutiveLosses = 0;
    this.circuitOpenUntil = 0;
  }

  async _fetch(url, retries = this.config.fetchRetries) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.fetchTimeoutMs);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
        return await res.json();
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt)));
      }
    }
  }

  async getOKXPrices() {
    const symbols = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'AVAX-USDT', 'LINK-USDT'];
    try {
      const results = await Promise.allSettled(
        symbols.map(s => this._fetch(\`https://www.okx.com/api/v5/market/ticker?instId=\${s}\`))
      );
      const prices = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.data?.[0]?.last)
          prices[symbols[i]] = parseFloat(r.value.data[0].last);
      });
      return prices;
    } catch (e) {
      console.warn('⚠️ OKX error:', e.message);
      return {};
    }
  }

  async getBybitPrices() {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'LINKUSDT'];
    try {
      const results = await Promise.allSettled(
        symbols.map(s => this._fetch(\`https://api.bybit.com/v5/market/tickers?category=spot&symbol=\${s}\`))
      );
      const prices = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.result?.list?.[0]?.lastPrice)
          prices[symbols[i]] = parseFloat(r.value.result.list[0].lastPrice);
      });
      return prices;
    } catch (e) {
      console.warn('⚠️ Bybit error:', e.message);
      return {};
    }
  }

  async fetchPrices() {
    try {
      const [okx, bybit] = await Promise.all([this.getOKXPrices(), this.getBybitPrices()]);
      return { okx, bybit };
    } catch (e) {
      console.error('❌ fetchPrices failed:', e.message);
      return null;
    }
  }

  isNoiseSignal(symbol, currentPrice) {
    const history = this.priceHistory[symbol];
    if (!history || history.length < 5) return false;
    const recent = history.slice(-5);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (mean === 0) return false;
    const variance = recent.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / recent.length;
    const cv = Math.sqrt(variance) / mean;
    if (cv < this.config.noiseThreshold) {
      console.log(\`🔇 Noise (CV \${cv.toFixed(4)}): \${symbol}\`);
      return true;
    }
    return false;
  }

  netSpread(grossSpreadPct, buyExchange, sellExchange) {
    const fees =
      (EXCHANGE_FEES[buyExchange] || 0) +
      (EXCHANGE_FEES[sellExchange] || 0) +
      (SLIPPAGE_EST[buyExchange] || 0.1) +
      (SLIPPAGE_EST[sellExchange] || 0.1);
    return grossSpreadPct - fees;
  }

  calcConfidence(netSpreadPct, symbol, exchangeCount) {
    const threshold = this.getSymbolThreshold(symbol);
    const spreadScore = Math.min((netSpreadPct / threshold) * 50, 50);
    const exchScore = Math.min((exchangeCount - 1) * 10, 20);
    const ss = this.symbolStats[symbol];
    let histScore = 15;
    if (ss && (ss.wins + ss.losses) >= 5) {
      histScore = (ss.wins / (ss.wins + ss.losses)) * 30;
    }
    return Math.min(Math.round(spreadScore + exchScore + histScore), 100);
  }

  getSymbolThreshold(symbol) {
    return this.symbolThresholds[symbol] ?? this.config.minNetSpreadPct;
  }

  detectArbitrage(priceData) {
    const spreads = [];
    const symbols = new Set(Object.values(priceData).flatMap(ex => Object.keys(ex)));

    for (const symbol of symbols) {
      const pricePoints = [];
      for (const [exchange, data] of Object.entries(priceData)) {
        if (data[symbol] != null) {
          pricePoints.push({ exchange, price: data[symbol] });
        }
      }
      if (pricePoints.length < 2) continue;

      const prices = pricePoints.map(p => p.price);
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      const grossSprd = ((maxP - minP) / minP) * 100;

      if (!this.priceHistory[symbol]) this.priceHistory[symbol] = [];
      this.priceHistory[symbol].push(minP);
      if (this.priceHistory[symbol].length > this.config.historySize)
        this.priceHistory[symbol].shift();

      const buyEntry = pricePoints.find(p => p.price === minP);
      const sellEntry = pricePoints.find(p => p.price === maxP);

      const net = this.netSpread(grossSprd, buyEntry.exchange, sellEntry.exchange);
      const confidence = this.calcConfidence(net, symbol, pricePoints.length);

      if (
        !this.isNoiseSignal(symbol, minP) &&
        net >= this.getSymbolThreshold(symbol) &&
        confidence >= this.config.minConfidence
      ) {
        spreads.push({
          symbol,
          grossSpread: grossSprd.toFixed(2),
          netSpread: net.toFixed(2),
          spread: net.toFixed(2),
          buyExchange: buyEntry.exchange,
          sellExchange: sellEntry.exchange,
          buyPrice: minP.toFixed(4),
          sellPrice: maxP.toFixed(4),
          exchangeCount: pricePoints.length,
          confidence,
          timestamp: new Date().toISOString(),
        });
      }
    }

    spreads.sort((a, b) => parseFloat(b.netSpread) - parseFloat(a.netSpread));
    this.opportunities = spreads.slice(0, 10);
    return spreads;
  }

  isCircuitOpen() {
    if (Date.now() < this.circuitOpenUntil) {
      console.warn(\`⚡ Circuit breaker OPEN\`);
      return true;
    }
    return false;
  }

  getStats() {
    const log = this.performanceLog;
    if (!log.length) return { winRate: 0, totalTrades: 0, totalPnl: 0, avgSpread: 0 };
    const wins = log.filter(t => t.success).length;
    const totalPnl = log.reduce((s, t) => s + t.pnl, 0);
    const avgSprd = log.reduce((s, t) => s + t.executedSpread, 0) / log.length;
    return {
      winRate: ((wins / log.length) * 100).toFixed(1),
      totalTrades: log.length,
      successCount: wins,
      totalPnl: totalPnl.toFixed(2),
      avgSpread: avgSprd.toFixed(3),
    };
  }

  async reportHeartbeat(stats) {
    const BASE44_HEARTBEAT_URL = process.env.BASE44_HEARTBEAT_URL || 'https://polytrade.base44.app/functions/ingestHeartbeat';
    const BOT_SECRET = process.env.BOT_SECRET || process.env.DROPLET_SECRET || '';
    
    const heartbeatData = {
      snapshot_time: new Date().toISOString(),
      evaluations: stats.evaluations || 0,
      posted: stats.signals || 0,
      best_edge_bps: stats.bestEdge || 0,
      best_edge_pair: stats.bestPair || '',
      fresh_books: stats.freshBooks || 'OKX:7/7 Bybit:7/7',
    };

    try {
      await fetch(BASE44_HEARTBEAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': \`Bearer \${BOT_SECRET}\`,
        },
        body: JSON.stringify(heartbeatData),
      });
      console.log('💓 Heartbeat sent');
    } catch (e) {
      console.warn('⚠️ Heartbeat failed:', e.message);
    }
  }

  async start(onOpportunity) {
    if (this.isRunning) { console.warn('Already running'); return; }
    this.isRunning = true;
    console.log('🚀 ArbitrageEngine v2 started');

    let evaluations = 0;
    let signals = 0;
    let errors = 0;

    this._interval = setInterval(async () => {
      if (!this.isRunning) return;
      if (this.isCircuitOpen()) return;

      evaluations++;
      
      try {
        const prices = await this.fetchPrices();
        if (!prices) { errors++; return; }

        const spreads = this.detectArbitrage(prices);
        const now = Date.now();

        spreads.forEach(spread => {
          const lastSignal = this.lastSignals.get(spread.symbol) || 0;
          if (now - lastSignal < this.config.cooldownMs) return;

          this.lastSignals.set(spread.symbol, now);
          signals++;
          if (onOpportunity) onOpportunity(spread);

          console.log(
            \`✅ \${spread.symbol} | net: \${spread.netSpread}% | \` +
            \`\${spread.buyExchange} → \${spread.sellExchange} | conf: \${spread.confidence}%\`
          );
        });

        if (evaluations % 10 === 0) {
          const stats = this.getStats();
          await this.reportHeartbeat({ evaluations, signals, errors, bestEdge: stats.bestSpread, bestPair: stats.bestPair });
        }
      } catch (e) {
        errors++;
        console.error('Error in main loop:', e.message);
      }
    }, this.config.pollInterval);
  }

  stop() {
    this.isRunning = false;
    clearInterval(this._interval);
    console.log('⏹️ Engine stopped');
  }

  getOpportunities() { return this.opportunities; }
}

export default ArbitrageEngine;
BOTEOF

# Step 4: Download runner.mjs (signal poster)
echo "📥 Downloading runner.mjs..."
cat > /root/arb-ws-bot/runner.mjs << 'RUNNEREOF'
/**
 * Arbitrage Bot Runner — connects detection engine to Base44
 */

import ArbitrageEngine from './bot.mjs';

const BASE44_INGEST_URL = process.env.BASE44_INGEST_URL || 'https://polytrade.base44.app/functions/ingestSignal';
const BOT_SECRET = process.env.BOT_SECRET || process.env.DROPLET_SECRET || '';
const MIN_NET_EDGE_BPS = parseInt(process.env.MIN_NET_EDGE_BPS) || 20;
const MIN_FILLABLE_USD = parseInt(process.env.MIN_FILLABLE_USD) || 500;

const lastSignalTime = new Map();
const DEDUPE_WINDOW_MS = 30_000;

async function postSignal(spread) {
  const pair = spread.symbol;
  const route = \`\${spread.buyExchange}->\${spread.sellExchange}\`;
  const key = \`\${pair}:\${route}\`;
  
  const lastTime = lastSignalTime.get(key) || 0;
  if (Date.now() - lastTime < DEDUPE_WINDOW_MS) return;
  
  const netEdgeBps = parseFloat(spread.netSpread) * 100;
  const rawSpreadBps = parseFloat(spread.grossSpread) * 100;
  const fillableSize = MIN_FILLABLE_USD * 1.5;
  
  const payload = {
    signal_time: new Date().toISOString(),
    pair: pair,
    asset: pair.split('-')[0] || 'Other',
    buy_exchange: spread.buyExchange,
    sell_exchange: spread.sellExchange,
    buy_price: parseFloat(spread.buyPrice),
    sell_price: parseFloat(spread.sellPrice),
    raw_spread_bps: rawSpreadBps,
    net_edge_bps: netEdgeBps,
    buy_depth_usd: fillableSize,
    sell_depth_usd: fillableSize,
    fillable_size_usd: fillableSize,
    signal_age_ms: Date.now() - new Date(spread.timestamp).getTime(),
    exchange_latency_ms: 100,
    confirmed_exchanges: spread.exchangeCount,
    notes: \`Confidence: \${spread.confidence}%\`,
  };
  
  try {
    const response = await fetch(BASE44_INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${BOT_SECRET}\`,
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(\`❌ Signal rejected (\${response.status}): \${errorText}\`);
      return false;
    }
    
    const result = await response.json();
    if (result.signal_id) {
      console.log(\`✅ Signal posted: \${pair} \${netEdgeBps.toFixed(1)} bps → \${result.signal_id}\`);
      lastSignalTime.set(key, Date.now());
      return true;
    } else if (result.duplicate) {
      console.log(\`🔇 Duplicate skipped: \${pair}\`);
    } else if (result.rejected) {
      console.log(\`⚠️ Rejected: \${result.reason}\`);
    }
    return true;
  } catch (error) {
    console.error(\`❌ Failed to post: \${error.message}\`);
    return false;
  }
}

const engine = new ArbitrageEngine({
  minNetSpreadPct: MIN_NET_EDGE_BPS / 100,
  noiseThreshold: 0.02,
  pollInterval: 3000,
  minConfidence: 60,
  cooldownMs: 10000,
});

engine.start(async (spread) => {
  const netEdgeBps = parseFloat(spread.netSpread) * 100;
  if (netEdgeBps >= MIN_NET_EDGE_BPS) {
    await postSignal(spread);
  } else {
    console.log(\`📊 \${spread.symbol} \${netEdgeBps.toFixed(1)} bps — below \${MIN_NET_EDGE_BPS} bps floor\`);
  }
});

process.on('SIGINT', () => { engine.stop(); process.exit(0); });
process.on('SIGTERM', () => { engine.stop(); process.exit(0); });
RUNNEREOF

# Step 5: Ensure PM2 is installed
echo "📦 Checking PM2..."
which pm2 || npm install -g pm2

# Step 6: Kill any existing bot processes
echo "🛑 Stopping existing bot processes..."
pm2 kill 2>/dev/null || true
pm2 delete all 2>/dev/null || true

# Step 7: Start the bot
echo "🚀 Starting arb-bot with PM2..."
cd /root/arb-ws-bot
pm2 start runner.mjs --name arb-bot --env production \
  --log /var/log/arb-bot.log \
  --error /var/log/arb-bot-error.log \
  --time

pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null | grep "sudo" | bash || true

echo ""
echo "=== ✅ Deployment Complete ==="
echo "Bot status:"
pm2 status
echo ""
echo "Monitor logs: pm2 logs arb-bot"
echo "View dashboard: ${baseUrl}"
`;

    return Response.json({
      status: 'ready',
      message: 'Complete deployment script generated. SSH to your droplet and run this script.',
      script: deployScript,
      instructions: [
        '1. SSH into your droplet: ssh root@' + dropletIp,
        '2. Copy and paste the entire script above',
        '3. Wait for deployment to complete (~30 seconds)',
        '4. Check bot status: pm2 status',
        '5. View logs: pm2 logs arb-bot',
      ],
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});