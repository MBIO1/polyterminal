/**
 * Mock Price Injector — simulates realistic spreads (0.5-2%) between CEX exchanges
 * for testing bot execution logic without waiting for perfect market conditions
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const action = body.action || 'inject';

  // ── Enable/disable mock mode ──────────────────────────────────────────────
  if (action === 'toggle') {
    const configs = await base44.asServiceRole.entities.BotConfig.list();
    const config = configs[0];
    if (!config) return Response.json({ error: 'No config found' }, { status: 400 });

    const newMockMode = !config.mock_mode_enabled;
    await base44.asServiceRole.entities.BotConfig.update(config.id, {
      mock_mode_enabled: newMockMode,
    });

    return Response.json({
      mock_mode_enabled: newMockMode,
      message: newMockMode ? '✅ Mock mode ON — bot will trade with injected spreads' : '❌ Mock mode OFF — using real prices',
    });
  }

  // ── Inject spreads into prices ────────────────────────────────────────────
  if (action === 'inject') {
    const { btcBinance, btcCoinbase, ethBinance, ethCoinbase } = body.prices || {};
    if (!btcBinance || !ethBinance) return Response.json({ error: 'Missing price data' }, { status: 400 });

    // Generate realistic spreads: Binance typically leads (faster), Coinbase lags
    // Spread: 0.5% - 2% with higher probability toward 0.5-1%
    const generateSpread = () => {
      const rand = Math.random();
      if (rand < 0.6) return 0.005 + Math.random() * 0.005; // 0.5-1%: 60% probability
      if (rand < 0.85) return 0.01 + Math.random() * 0.005; // 1-1.5%: 25% probability
      return 0.015 + Math.random() * 0.005; // 1.5-2%: 15% probability
    };

    const btcSpread = generateSpread();
    const ethSpread = generateSpread();

    // Binance leads → show higher price; Coinbase lags → show lower price
    const injectedBtcCoinbase = btcBinance / (1 + btcSpread);
    const injectedEthCoinbase = ethBinance / (1 + ethSpread);

    return Response.json({
      injected: {
        btc: { binance: btcBinance, coinbase: injectedBtcCoinbase, spread_pct: (btcSpread * 100).toFixed(3) },
        eth: { binance: ethBinance, coinbase: injectedEthCoinbase, spread_pct: (ethSpread * 100).toFixed(3) },
      },
      original: { btc: { binance: btcBinance, coinbase: btcCoinbase }, eth: { binance: ethBinance, coinbase: ethCoinbase } },
    });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
});