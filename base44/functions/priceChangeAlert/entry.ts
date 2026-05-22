// Detects major price movements and sends Telegram alerts
// Monitors ArbScanSnapshot for significant basis/price changes
// Run every 5 minutes via scheduled automation

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

// Thresholds for major price changes
const PRICE_CHANGE_THRESHOLD_PCT = 2.0; // Alert if price moves >2%
const BASIS_CHANGE_THRESHOLD_BPS = 50; // Alert if basis moves >50 bps

async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[PriceAlert] Telegram not configured');
    return { sent: false };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error('[PriceAlert] Telegram failed:', await res.text());
      return { sent: false };
    }
    return { sent: true };
  } catch (e) {
    console.error('[PriceAlert] Telegram error:', e.message);
    return { sent: false };
  }
}

function formatPriceChangeAlert(asset, oldPrice, newPrice, oldBasis, newBasis) {
  const priceChangePct = ((newPrice - oldPrice) / oldPrice) * 100;
  const basisChangeBps = newBasis - oldBasis;
  const direction = priceChangePct >= 0 ? '📈' : '📉';
  const color = priceChangePct >= 0 ? 'green' : 'red';

  let msg = `${direction} <b>MAJOR PRICE MOVEMENT</b>\n`;
  msg += '━━━━━━━━━━━━━━━━━━━━━\n\n';
  msg += `<b>Asset:</b> ${asset}\n`;
  msg += `<b>Price Change:</b> <span class="tg-span">${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%</span>\n`;
  msg += `<b>Old Price:</b> $${oldPrice.toFixed(2)}\n`;
  msg += `<b>New Price:</b> $${newPrice.toFixed(2)}\n\n`;
  msg += `<b>Basis Change:</b> ${basisChangeBps >= 0 ? '+' : ''}${basisChangeBps.toFixed(1)} bps\n`;
  msg += `<b>Old Basis:</b> ${oldBasis.toFixed(1)} bps\n`;
  msg += `<b>New Basis:</b> ${newBasis.toFixed(1)} bps\n\n`;
  msg += `<i>Detected at: ${new Date().toUTCString()}</i>`;
  
  return msg;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;

    // Load alert settings
    const alertSettings = (await svc.entities.AlertThreshold.list('-created_date', 1))[0] || {};
    const tgEnabled = alertSettings.tg_trade_lifecycle !== false; // Use general TG toggle

    if (!tgEnabled) {
      return Response.json({ ok: true, skipped: true, reason: 'Telegram alerts disabled' });
    }

    // Get recent snapshots (last 2 hours = 24 snapshots at 5min intervals)
    const snapshots = await svc.entities.ArbScanSnapshot.list('-snapshot_time', 24);
    if (snapshots.length < 2) {
      return Response.json({ ok: true, status: 'insufficient_data', snapshots: snapshots.length });
    }

    const now = Date.now();
    const alertsSent = [];

    // Group by asset
    const byAsset = {};
    snapshots.forEach(s => {
      if (!byAsset[s.asset]) byAsset[s.asset] = [];
      byAsset[s.asset].push(s);
    });

    // Compare each asset's latest vs previous snapshot
    for (const [asset, data] of Object.entries(byAsset)) {
      if (data.length < 2) continue;

      const latest = data[0];
      const previous = data[1];

      if (!latest.spot_price || !previous.spot_price) continue;

      const priceChangePct = Math.abs((latest.spot_price - previous.spot_price) / previous.spot_price) * 100;
      const basisChangeBps = Math.abs((latest.basis_bps || 0) - (previous.basis_bps || 0));

      // Check if thresholds exceeded
      if (priceChangePct >= PRICE_CHANGE_THRESHOLD_PCT || basisChangeBps >= BASIS_CHANGE_THRESHOLD_BPS) {
        const msg = formatPriceChangeAlert(
          asset,
          previous.spot_price,
          latest.spot_price,
          previous.basis_bps || 0,
          latest.basis_bps || 0
        );

        const result = await sendTelegramAlert(msg);
        if (result.sent) {
          alertsSent.push({ asset, priceChangePct, basisChangeBps });
          console.log(`[PriceAlert] Alert sent for ${asset}: price ${priceChangePct.toFixed(2)}%, basis ${basisChangeBps.toFixed(1)} bps`);
        }
      }
    }

    return Response.json({
      ok: true,
      checked_at: new Date().toISOString(),
      snapshots_analyzed: snapshots.length,
      alerts_sent: alertsSent.length,
      details: alertsSent,
    });

  } catch (error) {
    console.error('[PriceAlert] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});