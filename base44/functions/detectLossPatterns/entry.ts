/**
 * detectLossPatterns — Analyzes recent trades to identify loss patterns
 * and blocks the bot from repeating the same losing combinations.
 *
 * Returns:
 *   - blockedPatterns: array of {asset, contractType, side} combinations to avoid
 *   - recentWinRate: win rate over last 20 trades
 *   - shouldReduceSizing: bool — if true, use smaller Kelly fraction
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Fetch recent trades (last 50)
  const recentTrades = await base44.asServiceRole.entities.BotTrade.list('-created_date', 50);

  if (recentTrades.length < 5) {
    return Response.json({
      blockedPatterns: [],
      recentWinRate: 0,
      shouldReduceSizing: false,
      reason: 'Not enough trade history',
    });
  }

  const resolved = recentTrades.filter(t => t.outcome === 'win' || t.outcome === 'loss');
  const recent20 = resolved.slice(0, 20);
  const recent5 = resolved.slice(0, 5);

  // ── Pattern Detection ──────────────────────────────────────────────────────
  // Count consecutive losses per {asset, contractType, side} combination
  const patternStats = {};
  const patternKey = (t) => `${t.asset}|${t.contract_type}|${t.side}`;

  resolved.forEach((t) => {
    const key = patternKey(t);
    if (!patternStats[key]) {
      patternStats[key] = { wins: 0, losses: 0, consecutive: 0 };
    }
    if (t.outcome === 'loss') {
      patternStats[key].losses++;
      patternStats[key].consecutive++;
    } else {
      patternStats[key].wins++;
      patternStats[key].consecutive = 0;
    }
  });

  // Block patterns that:
  // 1. Have 3+ consecutive losses in the last 20 trades
  // 2. Have >70% loss rate overall (≥ 4 losses out of 5)
  const blockedPatterns = Object.entries(patternStats)
    .filter(([, stats]) => {
      // Check if any recent 5-trade window has 3+ losses
      let hasConsecutiveStreak = false;
      let lossStreak = 0;
      recent5.forEach((t) => {
        if (patternKey(t) === patternKey(resolved.find(r => patternKey(r) === patternKey(t)))) {
          if (t.outcome === 'loss') {
            lossStreak++;
            if (lossStreak >= 3) hasConsecutiveStreak = true;
          } else {
            lossStreak = 0;
          }
        }
      });

      const lossPct = stats.losses / (stats.wins + stats.losses) || 0;
      return hasConsecutiveStreak || lossPct > 0.7;
    })
    .map(([key]) => {
      const [asset, contractType, side] = key.split('|');
      return { asset, contractType, side };
    });

  // ── Sizing Adjustment ─────────────────────────────────────────────────────
  // If last 20 trades have < 40% win rate, reduce Kelly sizing
  const recentWinRate = (recent20.filter(t => t.outcome === 'win').length / recent20.length) * 100;
  const shouldReduceSizing = recentWinRate < 40;

  // ── Log the findings ───────────────────────────────────────────────────────
  if (blockedPatterns.length > 0) {
    const msg = `⚠️ Loss patterns detected: ${blockedPatterns
      .map((p) => `${p.asset} ${p.contractType} ${p.side}`)
      .join(', ')} — blocking for next ${Math.ceil(recentTrades.length / 10)} scans`;
  }

  return Response.json({
    blockedPatterns,
    recentWinRate: Number(recentWinRate.toFixed(1)),
    shouldReduceSizing,
    recent5Count: recent5.length,
    totalAnalyzed: resolved.length,
  });
});