// Generic Slack alert dispatcher for Arb Desk operational events.
// Supports both direct invocation (alert_type + fields) and entity automation
// payloads (ArbException create events).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SEVERITY_COLOR = {
  Low: '#94a3b8',
  Medium: '#f59e0b',
  High: '#ef4444',
  Critical: '#b91c1c',
};

const ALERT_META = {
  exception:              { emoji: '🚨', label: 'Exception',                default: 'High' },
  service_failure:        { emoji: '💥', label: 'Service Failure',          default: 'Critical' },
  workbook_build_failure: { emoji: '📘', label: 'Workbook Build Failure',   default: 'High' },
  reconciliation:         { emoji: '🧾', label: 'Reconciliation Mismatch',  default: 'High' },
  margin_breach:          { emoji: '⚠️', label: 'Margin Threshold Breach',  default: 'Critical' },
  funding_anomaly:        { emoji: '📈', label: 'Funding Anomaly',          default: 'High' },
  missing_run:            { emoji: '⏰', label: 'Missing Scheduled Run',    default: 'High' },
  transfer_stuck:         { emoji: '🔁', label: 'Transfer Not Confirmed',   default: 'High' },
};

async function postToTelegram({ alertType, severity, title, description, fields }) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return; // silently skip if not configured

  const meta = ALERT_META[alertType] || ALERT_META.exception;
  const sev = severity || meta.default;
  const lines = [
    `${meta.emoji} <b>${meta.label} — ${sev}</b>${title ? ` · ${title}` : ''}`,
    '━━━━━━━━━━━━━━━━━━━━━━',
    description || '(no details)',
  ];
  const fieldLines = (fields || [])
    .filter(f => f && f.value !== undefined && f.value !== null && f.value !== '')
    .map(f => `<b>${f.title}:</b> <code>${String(f.value)}</code>`);
  if (fieldLines.length) {
    lines.push('');
    lines.push(...fieldLines);
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('Telegram send failed', res.status, errText);
    }
  } catch (err) {
    console.error('Telegram send error', err);
  }
}

async function postToSlack(webhook, { alertType, severity, title, description, fields }) {
  const meta = ALERT_META[alertType] || ALERT_META.exception;
  const sev = severity || meta.default;
  const color = SEVERITY_COLOR[sev] || '#94a3b8';
  const header = `${meta.emoji} ${meta.label} — ${sev}${title ? ` · ${title}` : ''}`;

  const payload = {
    text: header,
    attachments: [{
      color,
      title: header,
      text: description || '(no details)',
      fields: (fields || []).filter(f => f && f.value !== undefined && f.value !== null && f.value !== '')
        .map(f => ({ title: f.title, value: String(f.value), short: f.short !== false })),
      footer: 'Arb Desk',
      ts: Math.floor(Date.now() / 1000),
    }],
  };

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('Slack webhook failed', res.status, errText);
    throw new Error(`slack webhook ${res.status}: ${errText}`);
  }
}

Deno.serve(async (req) => {
  try {
    const webhook = Deno.env.get('SLACK_WEBHOOK_URL');
    if (!webhook) {
      console.error('SLACK_WEBHOOK_URL is not set');
      return Response.json({ error: 'SLACK_WEBHOOK_URL missing' }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));

    // ---------- Mode 1: entity automation (ArbException create) ----------
    if (body?.event?.entity_name === 'ArbException') {
      if (body.event.type && body.event.type !== 'create') {
        return Response.json({ skipped: true, reason: 'not a create event' });
      }
      let exc = body.data;
      if (!exc && body.event.entity_id) {
        const base44 = createClientFromRequest(req);
        exc = await base44.asServiceRole.entities.ArbException.get(body.event.entity_id);
      }
      if (!exc) return Response.json({ error: 'no exception data' }, { status: 400 });

      const excArgs = {
        alertType: 'exception',
        severity: exc.severity,
        title: exc.exception_id || '',
        description: exc.description,
        fields: [
          { title: 'Type', value: exc.type },
          { title: 'Status', value: exc.status },
          { title: 'Exchange', value: exc.exchange },
          { title: 'Asset', value: exc.asset },
          { title: 'Trade', value: exc.linked_trade_id },
          { title: 'Owner', value: exc.owner },
        ],
      };
      await Promise.all([
        postToSlack(webhook, excArgs),
        postToTelegram(excArgs),
      ]);
      return Response.json({ ok: true, mode: 'exception' });
    }

    // ---------- Mode 2: direct invocation ----------
    const {
      alert_type = 'exception',
      severity,
      title = '',
      description = '',
      fields = [],
    } = body || {};

    if (!ALERT_META[alert_type]) {
      return Response.json({ error: `unknown alert_type: ${alert_type}` }, { status: 400 });
    }

    const directArgs = {
      alertType: alert_type,
      severity,
      title,
      description,
      fields,
    };
    await Promise.all([
      postToSlack(webhook, directArgs),
      postToTelegram(directArgs),
    ]);
    return Response.json({ ok: true, mode: 'direct', alert_type });
  } catch (error) {
    console.error('slackAlert error', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});