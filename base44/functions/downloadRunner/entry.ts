/**
 * Download only the runner.mjs file to the droplet
 * Quick fix when runner.mjs is missing
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dropletIp = Deno.env.get('DROPLET_IP') || '<droplet-ip>';
    const baseUrl = Deno.env.get('BASE44_APP_URL') || 'https://polytrade.base44.app';
    // LOWERED defaults so the feed gets populated and we can observe bot performance.
    // Droplet .env still wins if set. (Was 20 bps / $500.)
    const minNetEdgeBps = '8';
    const minFillableUsd = '200';

    const runnerCode = `/**
 * Arbitrage Bot Runner — connects detection engine to Base44
 */

import { readFileSync } from 'fs';
import ArbitrageEngine from './bot.mjs';

// Load .env manually (PM2 doesn't auto-load .env files)
try {
  const envFile = readFileSync('/root/arb-ws-bot/.env', 'utf-8');
  envFile.split('\\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  });
  console.log('✅ Loaded .env file');
} catch (e) {
  console.warn('⚠️ Could not load .env:', e.message);
}

const BASE44_INGEST_URL = process.env.BASE44_INGEST_URL || '${baseUrl}/functions/ingestSignal';
const BOT_SECRET = process.env.BOT_SECRET || process.env.DROPLET_SECRET || '';
const MIN_NET_EDGE_BPS = parseInt(process.env.MIN_NET_EDGE_BPS) || ${minNetEdgeBps};
const MIN_FILLABLE_USD = parseInt(process.env.MIN_FILLABLE_USD) || ${minFillableUsd};

console.log(\`🔧 Config: INGEST_URL=\${BASE44_INGEST_URL}\`);
console.log(\`🔧 Config: BOT_SECRET=\${BOT_SECRET ? BOT_SECRET.slice(0, 8) + '...' : 'MISSING'}\`);
console.log(\`🔧 Config: MIN_NET_EDGE_BPS=\${MIN_NET_EDGE_BPS}\`);

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

// Lowered gates — surface more bot activity for performance review
const engine = new ArbitrageEngine({
  minNetSpreadPct: MIN_NET_EDGE_BPS / 100,
  noiseThreshold: 0.015,
  pollInterval: 2000,
  minConfidence: 40,
  cooldownMs: 5000,
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
`;

    // Deno-safe base64 encoding (no Node Buffer)
    const b64 = btoa(unescape(encodeURIComponent(runnerCode)));
    const oneLiner = `echo '${b64}' | base64 -d > /root/arb-ws-bot/runner.mjs && chmod +x /root/arb-ws-bot/runner.mjs && echo "✅ runner.mjs downloaded" && pm2 restart arb-bot`;

    const fullScript = `#!/bin/bash
set -e

echo "=== Downloading runner.mjs ==="

cd /root/arb-ws-bot

# Write runner.mjs
cat > /root/arb-ws-bot/runner.mjs << 'RUNNEREOF'
${runnerCode}
RUNNEREOF

chmod +x /root/arb-ws-bot/runner.mjs

echo "✅ runner.mjs downloaded"

# Restart the bot
echo "🔄 Restarting arb-bot..."
pm2 restart arb-bot

echo ""
echo "=== Done ==="
pm2 status
echo ""
echo "Monitor: pm2 logs arb-bot --lines 50"
`;

    return Response.json({
      status: 'ready',
      message: 'Download runner.mjs to fix the missing file error',
      script: fullScript,
      one_liner: oneLiner,
      instructions: [
        '1. SSH into your droplet: ssh root@' + dropletIp,
        '2. Copy and run the one-liner above (quick fix)',
        '3. Or copy the full script for detailed output',
        '4. Check status: pm2 status arb-bot',
      ],
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});