/**
 * polyCredentials — serves Polymarket credentials from server-side env vars.
 * Private keys and API secrets never touch the browser.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // Save: accept new values and update secrets is not possible server-side from user code,
  // so we just acknowledge — secrets must be set via the Base44 dashboard.
  if (body.action === 'check') {
    const walletAddress = Deno.env.get('POLY_WALLET_ADDRESS') || '';
    const apiKey        = Deno.env.get('POLY_API_KEY') || '';
    const apiSecret     = Deno.env.get('POLY_API_SECRET') || '';
    const passphrase    = Deno.env.get('POLY_API_PASSPHRASE') || '';
    const privateKey    = Deno.env.get('POLY_PRIVATE_KEY') || '';

    // Return masked values so the UI can confirm they are set — never return raw private key
    return Response.json({
      walletAddress,
      apiKey:     apiKey     ? '••••' + apiKey.slice(-4)     : '',
      apiSecret:  apiSecret  ? '••••' + apiSecret.slice(-4)  : '',
      passphrase: passphrase ? '••••' + passphrase.slice(-4) : '',
      privateKey: privateKey ? '••••' + privateKey.slice(-4) : '',
      allSet: !!(walletAddress && apiKey && apiSecret && passphrase && privateKey),
    });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
});