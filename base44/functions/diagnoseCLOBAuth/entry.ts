/**
 * CLOB Authentication Diagnostic — run server-side
 * Tests credentials, signatures, and connectivity
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }

  const results = [];
  let passed = 0, failed = 0;

  const test = (name, ok, message) => {
    if (ok) {
      passed++;
      results.push({ type: 'pass', name, message });
    } else {
      failed++;
      results.push({ type: 'fail', name, message });
    }
  };

  const warn = (name, message) => {
    results.push({ type: 'warn', name, message });
  };

  // Test 1: Credentials
  const apiKey = Deno.env.get('POLY_API_KEY');
  const apiSecret = Deno.env.get('POLY_API_SECRET');
  const passphrase = Deno.env.get('POLY_API_PASSPHRASE');
  const walletAddr = Deno.env.get('POLY_WALLET_ADDRESS');
  const privKey = Deno.env.get('POLY_PRIVATE_KEY');

  test('API Key exists', !!apiKey, apiKey ? `Set (${apiKey.length} chars)` : 'Missing');
  test('API Secret exists', !!apiSecret, apiSecret ? `Set (${apiSecret.length} chars)` : 'Missing');
  passphrase ? test('API Passphrase', true, `Set (${passphrase.length} chars)`) : warn('Passphrase', 'Not set (may be optional)');
  walletAddr ? test('Wallet Address', true, `${walletAddr.substring(0, 10)}...`) : warn('Wallet', 'Not set (may be optional)');
  privKey ? test('Private Key', true, `Set (${privKey.length} chars)`) : warn('Private Key', 'Not set (may be optional)');

  // Test 2: Timestamp
  const now = Date.now();
  test('Timestamp format', now.toString().length === 13, `${now} (13 digits ✓)`);

  // Test 3: HMAC generation
  if (apiSecret) {
    try {
      const encoder = new TextEncoder();
      const keyData = encoder.encode(apiSecret);
      const msg = encoder.encode('test_message');
      const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', key, msg);
      const b64 = btoa(String.fromCharCode.apply(null, new Uint8Array(sig)));
      test('HMAC-SHA256 generation', b64.length > 0, `Signature generated (${b64.length} chars)`);
    } catch (err) {
      test('HMAC-SHA256 generation', false, err.message);
    }
  }

  // Test 4: CLOB reachability
  try {
    const res = await Promise.race([
      fetch('https://clob.polymarket.com/prices', { signal: AbortSignal.timeout(5000) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5100))
    ]);
    test('CLOB API reachable', res.ok || res.status < 500, `Status ${res.status}`);
  } catch (err) {
    test('CLOB API reachable', false, err.message);
  }

  // Test 5: Check for geoblocking
  try {
    const res = await fetch('https://ipinfo.io?token=test', { signal: AbortSignal.timeout(3000) });
    const data = res.ok ? await res.json() : { country: 'Unknown' };
    const isUS = data.country === 'US';
    warn('Current location', isUS ? '⚠️ US IP detected (CLOB may block you)' : `${data.country || 'Unknown'} (OK)`);
  } catch {
    warn('Location check', 'Could not determine IP location');
  }

  return Response.json({
    summary: {
      passed,
      failed,
      credentialsSet: !!apiKey && !!apiSecret,
      readyForTesting: passed >= 3 && failed === 0
    },
    results,
    recommendations: [
      ...(failed > 0 ? ['❌ Fix failed tests above before attempting trades'] : []),
      ...(passed >= 3 && failed === 0 ? ['✅ Credentials and connectivity look good'] : []),
      'If still getting 401: Check Polymarket dashboard for API approval',
      'Consider using VPN if in US (CLOB may be geoblocked)',
      'Ensure timestamp is fresh (< 5 min old)',
    ]
  });
});