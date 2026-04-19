/**
 * testProxy — verifies Bright Data TCP CONNECT tunnel works from Deno Deploy
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  // Secrets are stored with swapped names:
  // BRIGHT_DATA_SUPERPROXY_HOST = full username (brd-customer-xxx-zone-yyy)
  // BRIGHT_DATA_SUPERPROXY_PORT = password
  const bdUser = Deno.env.get('BRIGHT_DATA_SUPERPROXY_HOST'); // full username
  const bdPass = Deno.env.get('BRIGHT_DATA_SUPERPROXY_PORT'); // password
  const logs = [];

  logs.push(`using user="${bdUser}" pass_len=${bdPass?.length}`);

  // Step 1: TCP connect to Bright Data superproxy
  let conn;
  try {
    logs.push('Opening TCP connection to brd.superproxy.io:22225...');
    conn = await Deno.connect({ hostname: 'brd.superproxy.io', port: 22225 });
    logs.push('TCP connected OK');
  } catch (e) {
    return Response.json({ success: false, step: 'tcp_connect', error: e.message, logs });
  }

  // Step 2: Send CONNECT
  try {
    const proxyAuth = btoa(`${bdUser}:${bdPass}`);
    const connectReq = `CONNECT clob.polymarket.com:443 HTTP/1.1\r\nHost: clob.polymarket.com:443\r\nProxy-Authorization: Basic ${proxyAuth}\r\n\r\n`;
    await conn.write(new TextEncoder().encode(connectReq));
    logs.push('CONNECT request sent');
  } catch (e) {
    conn.close();
    return Response.json({ success: false, step: 'connect_send', error: e.message, logs });
  }

  // Step 3: Read CONNECT response
  let connectResp;
  try {
    const buf = new Uint8Array(4096);
    const n = await conn.read(buf);
    connectResp = new TextDecoder().decode(buf.subarray(0, n));
    const statusLine = connectResp.split('\r\n')[0];
    logs.push(`CONNECT response: ${statusLine}`);

    if (!connectResp.includes('200')) {
      conn.close();
      // Try port 24000 as fallback
      logs.push('Port 22225 got non-200 — check zone settings in Bright Data dashboard');
      return Response.json({ success: false, step: 'connect_response', status: statusLine, full_resp: connectResp.slice(0, 500), logs });
    }
  } catch (e) {
    conn.close();
    return Response.json({ success: false, step: 'connect_read', error: e.message, logs });
  }

  // Step 4: TLS upgrade + send a simple GET to verify CLOB reachability
  try {
    const tlsConn = await Deno.startTls(conn, { hostname: 'clob.polymarket.com' });
    logs.push('TLS handshake OK');

    const httpReq = `GET /time HTTP/1.1\r\nHost: clob.polymarket.com\r\nConnection: close\r\n\r\n`;
    await tlsConn.write(new TextEncoder().encode(httpReq));

    const chunks = [];
    const readBuf = new Uint8Array(8192);
    while (true) {
      const nr = await tlsConn.read(readBuf).catch(() => null);
      if (nr === null) break;
      chunks.push(readBuf.slice(0, nr));
    }
    tlsConn.close();

    const fullResp = new TextDecoder().decode(
      chunks.reduce((a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }, new Uint8Array())
    );
    const statusLine = fullResp.split('\r\n')[0];
    const body = fullResp.split('\r\n\r\n').slice(1).join('').trim();
    logs.push(`CLOB /time response: ${statusLine}`);

    return Response.json({ success: true, clob_status: statusLine, clob_body: body.slice(0, 200), logs });
  } catch (e) {
    return Response.json({ success: false, step: 'tls_or_clob', error: e.message, logs });
  }
});