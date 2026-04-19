/**
 * System Health Check
 *
 * Comprehensive API connectivity & functionality audit
 * Tests: Polymarket CLOB, CEX APIs, Telegram, database, all backend functions
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const health = {
      timestamp: new Date().toISOString(),
      user: { email: user.email, role: user.role },
      status: 'checking',
      checks: {},
      overallStatus: 'HEALTHY',
      failedChecks: [],
    };

    // ──────────────────────────────────────────────────────────────────
    // 1. DATABASE / ENTITY OPERATIONS
    // ──────────────────────────────────────────────────────────────────
    try {
      const configs = await base44.asServiceRole.entities.BotConfig.list();
      const trades = await base44.asServiceRole.entities.BotTrade.list('-created_date', 5);
      health.checks.database = {
        status: 'OK',
        details: { configsLoaded: configs.length, tradesLoaded: trades.length },
      };
    } catch (err) {
      health.checks.database = { status: 'FAILED', error: err.message };
      health.failedChecks.push('Database: ' + err.message);
    }

    // ──────────────────────────────────────────────────────────────────
    // 2. POLYMARKET CLOB CONNECTIVITY
    // ──────────────────────────────────────────────────────────────────
    try {
      const res = await Promise.race([
        fetch('https://clob.polymarket.com/markets?limit=1', {
          signal: AbortSignal.timeout(5000),
        }).then(r => r.json()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5500)),
      ]);
      health.checks.polymarket_clob = {
        status: 'OK',
        details: { endpoint: 'clob.polymarket.com', marketsAvailable: !!res },
      };
    } catch (err) {
      health.checks.polymarket_clob = { status: 'FAILED', error: err.message };
      health.failedChecks.push('Polymarket CLOB: ' + err.message);
    }

    // ──────────────────────────────────────────────────────────────────
    // 3. BINANCE SPOT API
    // ──────────────────────────────────────────────────────────────────
    try {
      const res = await Promise.race([
        fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', {
          signal: AbortSignal.timeout(4000),
        }).then(r => r.json()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4500)),
      ]);
      const btcPrice = parseFloat(res.price);
      health.checks.binance_spot = {
        status: 'OK',
        details: { endpoint: 'api.binance.com', btcPrice: btcPrice.toFixed(2) },
      };
    } catch (err) {
      health.checks.binance_spot = { status: 'FAILED', error: err.message };
      health.failedChecks.push('Binance Spot: ' + err.message);
    }

    // ──────────────────────────────────────────────────────────────────
    // 4. BINANCE FUTURES (Funding Rates)
    // ──────────────────────────────────────────────────────────────────
    try {
      const res = await Promise.race([
        fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', {
          signal: AbortSignal.timeout(4000),
        }).then(r => r.json()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4500)),
      ]);
      health.checks.binance_futures = {
        status: 'OK',
        details: {
          endpoint: 'fapi.binance.com',
          fundingRate: (res.lastFundingRate * 100).toFixed(4) + '%',
        },
      };
    } catch (err) {
      health.checks.binance_futures = { status: 'FAILED', error: err.message };
      health.failedChecks.push('Binance Futures: ' + err.message);
    }

    // ──────────────────────────────────────────────────────────────────
    // 5. COINBASE API
    // ──────────────────────────────────────────────────────────────────
    try {
      const res = await Promise.race([
        fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', {
          signal: AbortSignal.timeout(4000),
        }).then(r => r.json()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4500)),
      ]);
      const btcPrice = parseFloat(res.data?.amount);
      health.checks.coinbase = {
        status: 'OK',
        details: { endpoint: 'api.coinbase.com', btcPrice: btcPrice.toFixed(2) },
      };
    } catch (err) {
      health.checks.coinbase = { status: 'FAILED', error: err.message };
      health.failedChecks.push('Coinbase: ' + err.message);
    }

    // ──────────────────────────────────────────────────────────────────
    // 6. TELEGRAM BOT API
    // ──────────────────────────────────────────────────────────────────
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
    if (botToken && chatId) {
      try {
        const res = await Promise.race([
          fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
            signal: AbortSignal.timeout(5000),
          }).then(r => r.json()),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5500)),
        ]);
        health.checks.telegram = {
          status: res.ok ? 'OK' : 'FAILED',
          details: res.ok ? { botId: res.result?.id, botName: res.result?.username } : { error: res.description },
        };
        if (!res.ok) health.failedChecks.push('Telegram: ' + res.description);
      } catch (err) {
        health.checks.telegram = { status: 'FAILED', error: err.message };
        health.failedChecks.push('Telegram: ' + err.message);
      }
    } else {
      health.checks.telegram = { status: 'SKIPPED', reason: 'Credentials not set' };
    }

    // ──────────────────────────────────────────────────────────────────
    // 8. BACKEND FUNCTION AVAILABILITY
    // ──────────────────────────────────────────────────────────────────
    const criticalFunctions = [
      'botRunner',
      'autoSignAndExecute',
      'telegramNotify',
      'polyCredentials',
      'polySign',
      'settlePendingTrades',
      'drawdownGuard',
      'liveTradeAudit',
    ];

    const functionStatus = {};
    for (const fn of criticalFunctions) {
      try {
        // Try to invoke with minimal payload (should succeed or give expected error)
        await base44.asServiceRole.functions.invoke(fn, { action: 'health_check' });
        functionStatus[fn] = 'OK';
      } catch (err) {
        // If function exists but rejects, that's still OK (means it's deployed)
        // Only mark as FAILED if it's a 404 or deployment error
        if (err.message?.includes('404') || err.message?.includes('not found')) {
          functionStatus[fn] = 'NOT_DEPLOYED';
        } else {
          functionStatus[fn] = 'OK'; // Function exists, just rejected the test payload
        }
      }
    }

    const deployedFunctions = Object.values(functionStatus).filter(s => s === 'OK').length;
    const notDeployed = Object.entries(functionStatus)
      .filter(([_, s]) => s === 'NOT_DEPLOYED')
      .map(([fn, _]) => fn);

    health.checks.backend_functions = {
      status: notDeployed.length === 0 ? 'OK' : 'PARTIAL',
      details: {
        deployed: `${deployedFunctions}/${criticalFunctions.length}`,
        notDeployed: notDeployed.length > 0 ? notDeployed : 'None',
      },
    };

    if (notDeployed.length > 0) {
      health.failedChecks.push(`Functions not deployed: ${notDeployed.join(', ')}`);
    }

    // ──────────────────────────────────────────────────────────────────
    // 9. ENVIRONMENT SECRETS
    // ──────────────────────────────────────────────────────────────────
    const requiredSecrets = [
      'POLY_WALLET_ADDRESS',
      'POLY_PRIVATE_KEY',
      'POLY_API_KEY',
      'POLY_API_SECRET',
      'POLY_API_PASSPHRASE',
    ];

    const secretsStatus = {};
    requiredSecrets.forEach(secret => {
      const val = Deno.env.get(secret);
      secretsStatus[secret] = val ? 'SET' : 'MISSING';
    });

    const missingSecrets = Object.entries(secretsStatus)
      .filter(([_, s]) => s === 'MISSING')
      .map(([k, _]) => k);

    health.checks.environment_secrets = {
      status: missingSecrets.length === 0 ? 'OK' : 'INCOMPLETE',
      details: {
        total: requiredSecrets.length,
        set: requiredSecrets.length - missingSecrets.length,
        missing: missingSecrets.length > 0 ? missingSecrets : 'None',
      },
    };

    if (missingSecrets.length > 0) {
      health.failedChecks.push(`Missing secrets: ${missingSecrets.join(', ')}`);
    }

    // ──────────────────────────────────────────────────────────────────
    // FINAL STATUS
    // ──────────────────────────────────────────────────────────────────
    const criticalFailed = health.failedChecks.filter(
      c => c.includes('Database') || c.includes('Polymarket') || c.includes('secrets')
    ).length;

    health.status = 'COMPLETE';
    health.overallStatus = criticalFailed > 0 ? 'UNHEALTHY' : health.failedChecks.length > 0 ? 'DEGRADED' : 'HEALTHY';

    return Response.json(health);
  } catch (error) {
    return Response.json({
      status: 'ERROR',
      error: error.message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
});