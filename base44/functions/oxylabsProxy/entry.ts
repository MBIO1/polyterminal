/**
 * Oxylabs Proxy Rotation Helper
 * Routes requests through residential IPs to bypass geoblocking
 */

const OXYLABS_USER = Deno.env.get('OXYLABS_USER');
const OXYLABS_PASS = Deno.env.get('OXYLABS_PASS');
const PROXY_ENDPOINT = 'http://pr.oxylabs.io:7777';

async function fetchViaOxylabs(url, options = {}, timeout = 15000) {
  if (!OXYLABS_USER || !OXYLABS_PASS) {
    throw new Error('Missing Oxylabs credentials: OXYLABS_USER or OXYLABS_PASS');
  }

  // Create proxy auth header
  const proxyAuth = btoa(`${OXYLABS_USER}:${OXYLABS_PASS}`);
  
  // Add proxy headers to request
  const proxyHeaders = {
    ...(options.headers || {}),
    'Proxy-Authorization': `Basic ${proxyAuth}`,
  };

  const proxyOptions = {
    ...options,
    headers: proxyHeaders,
  };

  // Wrap fetch with timeout
  return Promise.race([
    fetch(url, proxyOptions),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Proxy request timeout')), timeout)
    )
  ]);
}

function getProxyConfig() {
  return {
    isConfigured: !!(OXYLABS_USER && OXYLABS_PASS),
    endpoint: PROXY_ENDPOINT,
    user: OXYLABS_USER ? OXYLABS_USER.substring(0, 5) + '***' : 'NOT_SET',
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fetchViaOxylabs, getProxyConfig };
}