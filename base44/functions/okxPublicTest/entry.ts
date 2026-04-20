import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Public, unsigned OKX connectivity probe.
// Checks if Base44's egress can reach OKX endpoints (no API keys needed).
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const host = 'https://www.okx.com';

    async function probe(path) {
      const res = await fetch(`${host}${path}`);
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
      return { httpStatus: res.status, body };
    }

    const time = await probe('/api/v5/public/time');
    const ticker = await probe('/api/v5/market/ticker?instId=BTC-USDT');

    return Response.json({ host, serverTime: time, btcTicker: ticker });
  } catch (error) {
    console.error('okxPublicTest error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});