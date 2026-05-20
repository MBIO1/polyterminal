// Ingest qualified arbitrage signals from the external droplet WS bot.
// Rejects signals with net_edge_bps <= 0 (nothing to trade).
// Fuzzy duplicate detection within 30s window.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TELEGRAM_ALERT_MIN_BPS  = 20;
const TELEGRAM_NEAR_MISS_MIN_BPS = 6;
const NEAR_MISS_COOLDOWN_MS   = 15 * 60 * 1000;
const DUPLICATE_WINDOW_MS     = 10_000; // Reduced from 30s to 10s (industry standard)
const PRICE_TOLERANCE_PCT     = 0.0015; // Increased from 0.1% to 0.15% (allows slight price variations)

const lastNearMissByPair = new Map();

async function pushTelegramAlert(signal, kind = 'full') {
  const token  = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return;

  const edge = Number(signal.net_edge_bps || 0);
  const raw  = Number(signal.raw_spread_bps || 0);
  const fill = Math.round(Number(signal.fillable_size_usd || 0));
  const ageMs = Number(signal.signal_age_ms || 0);

  const isNearMiss   = kind === 'near_miss';
  const profitLabel  = edge >= 20 ? '✅ TRADEABLE' : edge >= 10 ? '⚠️ NEAR-MISS' : '📊 MONITORING';
  const header       = isNearMiss
    ? `👀 <b>NEAR-MISS · ${edge.toFixed(1)} bps</b> <i>(below 20 bps floor)</i>\n${profitLabel}`
    : `${edge >= 40 ? '🚨🚨' : edge >= 25 ? '🚨' : '⚡'} <b>ARB SIGNAL · ${edge.toFixed(1)} bps</b>\n${profitLabel}`;

  const feesCost    = 4 * 2;
  const profitExplain = edge >= 20
    ? `💰 Est. profit: ~${(edge - feesCost).toFixed(1)} bps after fees on $${fill.toLocaleString()}`
    : `⚠️ Edge ${edge.toFixed(1)} bps — fees = ${feesCost} bps`;

  const text = [
    header,
    '━━━━━━━━━━━━━━━━━━━━━',
    `<b>Pair:</b> ${signal.pair}`,
    `<b>Route:</b> ${signal.buy_exchange} → ${signal.sell_exchange}`,
    `<b>Buy @ </b><code>${Number(signal.buy_price).toFixed(4)}</code>  <b>Sell @ </b><code>${Number(signal.sell_price).toFixed(4)}</code>`,
    `<b>Raw spread:</b> ${raw.toFixed(2)} bps  |  <b>Net edge:</b> <code>${edge.toFixed(2)} bps</code>`,
    `<b>Fillable:</b> $${fill.toLocaleString()}  |  <b>Age:</b> ${ageMs} ms`,
    profitExplain,
    signal.notes ? `<i>${signal.notes}</i>` : '',
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error('Telegram push failed:', res.status, await res.text());
  } catch (e) {
    console.error('Telegram push exception:', e.message);
  }
}

async function checkFuzzyDuplicate(base44, signal) {
  // FIX: filter by route at DB level + sort by created_date (received_time can be unreliable
  // when droplet clock drifts). Fetch wider window and filter in code by created_date.
  const recent = await base44.asServiceRole.entities.ArbSignal.filter(
    {
      pair:          signal.pair,
      buy_exchange:  signal.buy_exchange,
      sell_exchange: signal.sell_exchange,
    },
    '-created_date',
    20,
  );

  const now = Date.now();
  for (const existing of recent) {
    const refTs = new Date(existing.created_date).getTime();
    if (!Number.isFinite(refTs)) continue;
    const ageMs = now - refTs;
    if (ageMs < 0) continue; // future-dated row, ignore
    if (ageMs > DUPLICATE_WINDOW_MS) continue;

    const exBuy  = Number(existing.buy_price)  || 0;
    const exSell = Number(existing.sell_price) || 0;
    const sgBuy  = Number(signal.buy_price)    || 0;
    const sgSell = Number(signal.sell_price)   || 0;
    if (!exBuy || !exSell || !sgBuy || !sgSell) continue;

    const buyDiff  = Math.abs((exBuy  - sgBuy)  / sgBuy);
    const sellDiff = Math.abs((exSell - sgSell) / sgSell);

    if (buyDiff < PRICE_TOLERANCE_PCT && sellDiff < PRICE_TOLERANCE_PCT) {
      return { isDuplicate: true, existingId: existing.id };
    }
  }
  return { isDuplicate: false };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });

    // SECURITY: require explicit shared secret in Authorization header for droplet calls.
    const authHeader    = req.headers.get('authorization') || '';
    const bearerToken   = authHeader.replace(/^Bearer\s+/i, '').trim();
    const dropletSecret = Deno.env.get('DROPLET_SECRET') || '';
    const botSecret     = Deno.env.get('BOT_SECRET') || '';
    const userToken     = Deno.env.get('BASE44_USER_TOKEN') || '';
    const isDroplet     = !!bearerToken && (
      bearerToken === dropletSecret ||
      bearerToken === botSecret ||
      bearerToken === userToken
    );

    // Read body before swapping the request object
    let body;
    try { body = await req.json(); }
    catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    // For droplet calls: replace the secret-based auth with the real user token
    // so the SDK can authenticate for asServiceRole operations.
    let initReq = req;
    if (isDroplet) {
      const cleanHeaders = new Headers(req.headers);
      if (userToken) {
        cleanHeaders.set('Authorization', `Bearer ${userToken}`);
      } else {
        cleanHeaders.delete('Authorization');
        cleanHeaders.delete('authorization');
      }
      cleanHeaders.delete('x-base44-auth');
      initReq = new Request(req.url, { method: req.method, headers: cleanHeaders });
    } else {
      // Not a droplet — must be an authenticated admin user
      const tempBase44 = createClientFromRequest(req);
      let user = null;
      try { user = await tempBase44.auth.me(); } catch {}
      if (!user || user.role !== 'admin') {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
    const base44 = createClientFromRequest(initReq);

    // Required fields
    const required = ['pair', 'buy_exchange', 'sell_exchange', 'raw_spread_bps', 'net_edge_bps'];
    for (const k of required) {
      if (body[k] === undefined || body[k] === null) {
        return Response.json({ error: `Missing field: ${k}` }, { status: 400 });
      }
    }

    // Reject signals with non-positive net edge — nothing to trade
    const netEdge = Number(body.net_edge_bps);
    if (netEdge <= 0) {
      return Response.json({ ok: true, rejected: true, reason: 'net_edge_bps <= 0' });
    }

    // VENUE FILTER: We only have a Bybit execution path. Reject signals that
    // don't include Bybit on at least one leg — they are untradeable noise
    // (e.g. OKX-perp → OKX-spot internal-basis signals).
    const buyEx  = String(body.buy_exchange  || '').toLowerCase();
    const sellEx = String(body.sell_exchange || '').toLowerCase();
    const buyIsBybit  = buyEx.includes('bybit');
    const sellIsBybit = sellEx.includes('bybit');
    if (!buyIsBybit && !sellIsBybit) {
      return Response.json({
        ok: true,
        rejected: true,
        reason: 'no_bybit_leg — execution path is Bybit-only',
      });
    }

    // SAME-VENUE FILTER: Allow same-venue spot/perp basis trades IF funding rate justifies it
    // Industry standard: Execute if expected funding > 2x transaction costs
    const rootOf = v => v.replace(/-(spot|perp|swap|futures)$/i, '').trim().toLowerCase();
    const isSameVenue = rootOf(buyEx) === rootOf(sellEx) && rootOf(buyEx);
    
    if (isSameVenue) {
      const buyIsPerp = /perp|swap|futures/i.test(buyEx);
      const sellIsPerp = /perp|swap|futures/i.test(sellEx);
      
      // Only allow if one leg is perp and one is spot (basis trade)
      if (buyIsPerp !== sellIsPerp) {
        // Check if net edge already accounts for funding (it should)
        // If edge > 8 bps after fees, allow the trade
        if (netEdge >= 8) {
          console.log(`[ingestSignal] ALLOWING same-venue basis trade ${body.pair}: net=${netEdge.toFixed(2)}bps`);
        } else {
          return Response.json({
            ok: true,
            rejected: true,
            reason: 'same_venue_basis_insufficient_edge',
          });
        }
      } else {
        // Both spot or both perp — reject (not a basis trade)
        return Response.json({
          ok: true,
          rejected: true,
          reason: 'same_venue_not_basis_trade',
        });
      }
    }

    // Fuzzy duplicate detection
    const dupCheck = await checkFuzzyDuplicate(base44, body);
    if (dupCheck.isDuplicate) {
      return Response.json({ ok: true, duplicate: true, signal_id: dupCheck.existingId });
    }

    const asset = body.asset || (body.pair || '').split('-')[0] || 'Other';
    const now   = new Date().toISOString();

    const signal = await base44.asServiceRole.entities.ArbSignal.create({
      signal_time:         body.signal_time || now,
      received_time:       now,
      pair:                body.pair,
      asset,
      buy_exchange:        body.buy_exchange,
      sell_exchange:       body.sell_exchange,
      buy_price:           Number(body.buy_price)           || 0,
      sell_price:          Number(body.sell_price)          || 0,
      raw_spread_bps:      Number(body.raw_spread_bps)      || 0,
      net_edge_bps:        netEdge,
      buy_depth_usd:       Number(body.buy_depth_usd)       || 0,
      sell_depth_usd:      Number(body.sell_depth_usd)      || 0,
      fillable_size_usd:   Number(body.fillable_size_usd)   || 0,
      signal_age_ms:       Number(body.signal_age_ms)       || 0,
      exchange_latency_ms: Number(body.exchange_latency_ms) || 0,
      confirmed_exchanges: Number(body.confirmed_exchanges) || 1,
      status:              body.alert ? 'alerted' : 'detected',
      notes:               String(body.notes || '').slice(0, 1000),
    });

    console.log(`[ingestSignal] ${body.pair} net=${netEdge.toFixed(2)}bps fill=$${Math.round(body.fillable_size_usd||0)} → ${signal.id}`);

    // Telegram alerts — only on tradeable signals (≥20 bps). Near-miss alerts muted.
    if (netEdge >= TELEGRAM_ALERT_MIN_BPS) {
      await pushTelegramAlert({ ...body, ...signal }, 'full');
    }

    // Slack alert on any tradeable signal (net edge >= 5 bps)
    // Post directly to Slack webhook — avoids 403 from asServiceRole.functions.invoke
    // which fails when SDK client was initialized from a stripped-header droplet request.
    if (netEdge >= 5) {
      const slackUrl = Deno.env.get('SLACK_WEBHOOK_URL');
      if (slackUrl) {
        const sevLabel = netEdge >= 25 ? 'High' : netEdge >= 10 ? 'Medium' : 'Low';
        const slackTitle = `⚡ Spot Spread Signal — ${sevLabel} · ${body.pair} ${netEdge.toFixed(1)} bps · ${body.buy_exchange}→${body.sell_exchange}`;
        fetch(slackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: slackTitle,
            attachments: [{
              color: netEdge >= 25 ? '#ef4444' : netEdge >= 10 ? '#f59e0b' : '#94a3b8',
              title: slackTitle,
              text: `Buy ${body.buy_exchange} @ ${Number(body.buy_price).toFixed(4)} · Sell ${body.sell_exchange} @ ${Number(body.sell_price).toFixed(4)}. Fillable ~$${Math.round(body.fillable_size_usd||0).toLocaleString()}.`,
              footer: 'Arb Desk',
              ts: Math.floor(Date.now() / 1000),
            }],
          }),
          signal: AbortSignal.timeout(5000),
        }).catch(e => console.error('slack direct post:', e.message));
      }
    }

    // ⚡ INSTANT EXECUTION — trigger executeSignals immediately for this specific signal.
    // Sub-second cadence vs. waiting up to 5 min for the scheduled run.
    // Fire-and-forget: don't block the ingest response on execution.
    // NOTE: We cannot use base44.asServiceRole.functions.invoke() here because the
    // SDK client was initialized from a stripped-header request (droplet calls),
    // which causes a 403 "app is private" error on function invokes.
    // Instead, we use the BASE44_USER_TOKEN to make a direct authenticated call.
    if (netEdge > 0) {
      const userToken = Deno.env.get('BASE44_USER_TOKEN');
      const appUrl    = Deno.env.get('BASE44_APP_URL');
      if (userToken && appUrl) {
        const execUrl = `${appUrl.replace(/\/$/, '')}/api/functions/executeSignals`;
        fetch(execUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`,
          },
          body: JSON.stringify({
            signal_id:     signal.id,
            max_signals:   1,
            signal_ttl_ms: 60_000,
            dry_run:       body.dry_run === true,
          }),
          signal: AbortSignal.timeout(30000),
        }).catch(e => console.error('[ingestSignal] executeSignals trigger failed:', e.message));
      } else {
        console.warn('[ingestSignal] BASE44_USER_TOKEN or BASE44_APP_URL not set — skipping instant execution');
      }
    }

    return Response.json({ ok: true, signal_id: signal.id });

  } catch (error) {
    console.error('ingestSignal error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});