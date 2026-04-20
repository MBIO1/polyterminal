import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SEVERITY_COLOR = {
  Low: '#94a3b8',
  Medium: '#f59e0b',
  High: '#ef4444',
  Critical: '#b91c1c',
};

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const event = body?.event || {};
    const data = body?.data;

    // Only fire on create events
    if (event.type && event.type !== 'create') {
      return Response.json({ skipped: true, reason: 'not a create event' });
    }

    const webhook = Deno.env.get('SLACK_WEBHOOK_URL');
    if (!webhook) {
      console.error('SLACK_WEBHOOK_URL is not set');
      return Response.json({ error: 'SLACK_WEBHOOK_URL missing' }, { status: 500 });
    }

    // If payload was too large, fetch the record
    let exc = data;
    if (!exc && event.entity_id) {
      const base44 = createClientFromRequest(req);
      exc = await base44.asServiceRole.entities.ArbException.get(event.entity_id);
    }
    if (!exc) {
      return Response.json({ error: 'no exception data' }, { status: 400 });
    }

    const color = SEVERITY_COLOR[exc.severity] || '#94a3b8';
    const title = `🚨 Arb Exception ${exc.exception_id || ''} — ${exc.severity || 'Medium'}`;
    const fields = [
      { title: 'Type', value: exc.type || '—', short: true },
      { title: 'Status', value: exc.status || '—', short: true },
      { title: 'Exchange', value: exc.exchange || '—', short: true },
      { title: 'Asset', value: exc.asset || '—', short: true },
    ];
    if (exc.linked_trade_id) fields.push({ title: 'Trade', value: exc.linked_trade_id, short: true });
    if (exc.owner) fields.push({ title: 'Owner', value: exc.owner, short: true });

    const payload = {
      text: title,
      attachments: [
        {
          color,
          title,
          text: exc.description || '(no description)',
          fields,
          footer: 'Arb Desk',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Slack webhook failed', res.status, errText);
      return Response.json({ error: 'slack webhook failed', status: res.status, detail: errText }, { status: 502 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error('slackAlertException error', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});