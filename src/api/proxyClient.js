// API client that uses Vercel proxy to Base44
// No CORS issues, all requests go through /api/base44/*

const API_BASE = '';

async function apiRequest(functionName, method = 'GET', body = null, token = null) {
  const url = `${API_BASE}/api/base44/${functionName}`;
  
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API Error ${res.status}: ${error}`);
  }
  
  return res.json();
}

// Droplet Health
export const dropletHealthApi = {
  check: () => apiRequest('dropletHealth', 'GET'),
};

// Heartbeat
export const heartbeatApi = {
  ingest: (data) => apiRequest('ingestHeartbeat', 'POST', data),
  getRecent: () => apiRequest('dropletHealth', 'GET'),
};

// Signals
export const signalsApi = {
  ingest: (data) => apiRequest('ingestSignal', 'POST', data),
  getRecent: (limit = 50) => apiRequest(`signalStats?limit=${limit}`, 'GET'),
  getStats: () => apiRequest('signalStats', 'GET'),
};

// Trades
export const tradesApi = {
  getAll: () => apiRequest('getTrades', 'GET'),
  getOpen: () => apiRequest('getTrades?status=Open', 'GET'),
  execute: (data) => apiRequest('executeSignals', 'POST', data),
};

// Config
export const configApi = {
  get: () => apiRequest('getConfig', 'GET'),
  update: (data) => apiRequest('updateConfig', 'PUT', data),
};

// Analytics
export const analyticsApi = {
  getBotProductivity: () => apiRequest('botProductivity', 'GET'),
  getSystemAudit: () => apiRequest('systemAudit', 'GET'),
  getMarketScan: () => apiRequest('okxMarketScan', 'GET'),
};

export default {
  dropletHealth: dropletHealthApi,
  heartbeat: heartbeatApi,
  signals: signalsApi,
  trades: tradesApi,
  config: configApi,
  analytics: analyticsApi,
};
