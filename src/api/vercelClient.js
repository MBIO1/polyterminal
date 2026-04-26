// API client for Vercel deployment
// Uses Vercel serverless functions instead of Base44

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}/api${endpoint}`;
  
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API Error ${res.status}: ${error}`);
  }
  
  return res.json();
}

// Heartbeat API
export const heartbeatApi = {
  ingest: (data) => apiRequest('/heartbeat', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getRecent: () => apiRequest('/heartbeat'),
};

// Health API
export const healthApi = {
  check: () => apiRequest('/health'),
};

// Signals API
export const signalsApi = {
  ingest: (data) => apiRequest('/signals', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getRecent: (limit = 50) => apiRequest(`/signals?limit=${limit}`),
  getByStatus: (status) => apiRequest(`/signals?status=${status}`),
};

export default {
  heartbeat: heartbeatApi,
  health: healthApi,
  signals: signalsApi,
};
