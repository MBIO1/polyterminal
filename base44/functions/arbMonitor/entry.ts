// Scheduled monitor — detects operational issues and dispatches Slack alerts
// via slackAlert. Categories handled here:
//   • margin threshold breach (ArbLivePosition.margin_utilization_pct)
//   • funding anomaly         (abnormal realized_funding on recent trades)
//   • transfer not confirmed  (ArbTransfer past expected_arrival, still Pending)
//   • missing scheduled run   (this monitor self-reports if last_run_at is stale — done by callers of list_automations)
//   • service failure         (wrapped try/catch on the monitor itself)
// Run every 5 minutes via an automation.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MONITOR_WINDOW_MS = 15 * 60 * 1000; // dedupe window — don't re-alert same issue within 15 min

async function sendAlert(base44, payload) {
  try {
    await base44.functions.invoke('slackAlert', payload);
  } catch (e) {
    console.error('sendAlert failed', payload.alert_type, e?.message);
  }
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  const base44 = createClientFromRequest(req);
  const svc = base44.asServiceRole;

  const summary = { margin: 0, funding: 0, transfers: 0, errors: [] };

  try {
    const config = (await svc.entities.ArbConfig.list('-created_date', 1))[0] || {};
    const maxMarginPct = config.max_margin_utilization_pct ?? 0.35;

    // ---------- 1. Margin threshold breach ----------
    try {
      const positions = await svc.entities.ArbLivePosition.filter({ status: 'Open' }, '-snapshot_time', 200);
      for (const p of positions) {
        const util = p.margin_utilization_pct ?? 0;
        if (util > maxMarginPct) {
          summary.margin++;
          await sendAlert(base44, {
            alert_type: 'margin_breach',
            severity: util > maxMarginPct * 1.25 ? 'Critical' : 'High',
            title: `${p.asset} on ${p.perp_exchange || p.spot_exchange || '—'}`,
            description: `Margin utilization ${(util * 100).toFixed(1)}% exceeds configured limit ${(maxMarginPct * 100).toFixed(1)}%.`,
            fields: [
              { title: 'Asset', value: p.asset },
              { title: 'Utilization', value: `${(util * 100).toFixed(1)}%` },
              { title: 'Limit', value: `${(maxMarginPct * 100).toFixed(1)}%` },
              { title: 'Liq distance', value: p.liq_distance_pct != null ? `${(p.liq_distance_pct * 100).toFixed(1)}%` : '—' },
              { title: 'Linked trade', value: p.linked_trade_id },
            ],
          });
        }
      }
    } catch (e) { summary.errors.push(`margin: ${e.message}`); }

    // ---------- 2. Funding anomaly ----------
    // Flag open/closed trades where |realized_funding - expected_funding| exceeds 3x expected (or $50 absolute) on recent entries
    try {
      const recent = await svc.entities.ArbTrade.list('-updated_date', 100);
      const cutoff = Date.now() - MONITOR_WINDOW_MS;
      for (const t of recent) {
        if (!t.updated_date) continue;
        if (new Date(t.updated_date).getTime() < cutoff) continue;
        const exp = Number(t.expected_funding || 0);
        const real = Number(t.realized_funding || 0);
        if (!real) continue;
        const delta = Math.abs(real - exp);
        const threshold = Math.max(Math.abs(exp) * 3, 50);
        if (delta > threshold) {
          summary.funding++;
          await sendAlert(base44, {
            alert_type: 'funding_anomaly',
            severity: delta > threshold * 2 ? 'Critical' : 'High',
            title: t.trade_id,
            description: `Realized funding ${real.toFixed(2)} deviates from expected ${exp.toFixed(2)} by ${delta.toFixed(2)}.`,
            fields: [
              { title: 'Asset', value: t.asset },
              { title: 'Perp venue', value: t.perp_exchange },
              { title: 'Expected', value: exp.toFixed(2) },
              { title: 'Realized', value: real.toFixed(2) },
              { title: 'Δ', value: delta.toFixed(2) },
            ],
          });
        }
      }
    } catch (e) { summary.errors.push(`funding: ${e.message}`); }

    // ---------- 3. Transfer not confirmed in expected time ----------
    try {
      const pending = await svc.entities.ArbTransfer.filter({ status: 'Pending' }, '-transfer_date', 100);
      const now = Date.now();
      for (const tx of pending) {
        if (!tx.expected_arrival) continue;
        const expMs = new Date(tx.expected_arrival).getTime();
        if (now <= expMs) continue; // still within window
        const lateMin = Math.round((now - expMs) / 60000);
        // only alert once per window using a simple time gate (dedupe upstream in Slack)
        if (lateMin > 10 && lateMin < 10 + MONITOR_WINDOW_MS / 60000 + 6) {
          summary.transfers++;
          await sendAlert(base44, {
            alert_type: 'transfer_stuck',
            severity: lateMin > 60 ? 'Critical' : 'High',
            title: tx.transfer_id,
            description: `Transfer still Pending ${lateMin} min after expected arrival.`,
            fields: [
              { title: 'Type', value: tx.type },
              { title: 'Asset', value: tx.asset },
              { title: 'From', value: tx.from_exchange },
              { title: 'To', value: tx.to_exchange },
              { title: 'Qty', value: tx.quantity },
              { title: 'Expected', value: tx.expected_arrival },
              { title: 'Late by', value: `${lateMin} min` },
            ],
          });
        }
      }
    } catch (e) { summary.errors.push(`transfers: ${e.message}`); }

    // ---------- 4. Service self-failure ----------
    if (summary.errors.length) {
      await sendAlert(base44, {
        alert_type: 'service_failure',
        severity: 'High',
        title: 'arbMonitor partial failure',
        description: summary.errors.join(' | '),
        fields: [{ title: 'Duration ms', value: Date.now() - startedAt }],
      });
    }

    console.log('arbMonitor summary', summary);
    return Response.json({ ok: true, summary });
  } catch (error) {
    console.error('arbMonitor fatal', error);
    try {
      await sendAlert(base44, {
        alert_type: 'service_failure',
        severity: 'Critical',
        title: 'arbMonitor crashed',
        description: error.message,
      });
    } catch (_) { /* swallow */ }
    return Response.json({ error: error.message }, { status: 500 });
  }
});