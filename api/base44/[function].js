// Vercel API Proxy for Base44
// Securely forwards requests from Vercel frontend to Base44 backend

const BASE44_BASE_URL = 'https://polytrade.base44.app/functions';
const BASE44_APP_ID = 'c8d42feec2f84be1baa9f06400b2509f';

// Allowed functions (security whitelist)
const ALLOWED_FUNCTIONS = [
  'dropletHealth',
  'ingestHeartbeat', 
  'ingestSignal',
  'executeSignals',
  'signalStats',
  'botProductivity',
  'systemAudit',
  'arbMonitor',
  'okxMarketScan',
  'scanFunding',
  'getTrades',
  'getSignals',
  'getConfig',
  'updateConfig',
];

export default async function handler(req, res) {
  // Enable CORS for same-origin only (Vercel frontend)
  const origin = req.headers.origin || '';
  
  // In production, restrict to your Vercel domain
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Get function name from path
    const { function: functionName } = req.query;
    
    if (!functionName) {
      return res.status(400).json({ error: 'Function name required' });
    }

    // Security: Check whitelist
    if (!ALLOWED_FUNCTIONS.includes(functionName)) {
      console.warn(`Blocked request to unauthorized function: ${functionName}`);
      return res.status(403).json({ error: 'Function not allowed' });
    }

    // Build Base44 URL
    const base44Url = `${BASE44_BASE_URL}/${functionName}`;
    
    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
      'X-Base44-App-ID': BASE44_APP_ID,
    };

    // Forward authorization if present
    const authHeader = req.headers.authorization;
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    // Make request to Base44
    const response = await fetch(base44Url, {
      method: req.method,
      headers,
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });

    // Get response data
    const data = await response.json().catch(() => null);

    // Forward status and data
    return res.status(response.status).json(data || { error: 'Empty response from Base44' });

  } catch (error) {
    console.error('API Proxy Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
