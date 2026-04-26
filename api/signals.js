// Vercel Serverless Function: Signals API
// Route: /api/signals
// Methods: GET, POST

let signals = [];
const MAX_SIGNALS = 200;

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-droplet-auth');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    try {
      const data = req.body;
      
      const signal = {
        id: `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...data,
        received_time: new Date().toISOString(),
        status: data.status || 'detected',
      };
      
      signals.unshift(signal);
      
      // Keep only last 200
      if (signals.length > MAX_SIGNALS) {
        signals = signals.slice(0, MAX_SIGNALS);
      }
      
      console.log('📡 Signal ingested:', signal.pair, signal.net_edge_bps + ' bps');
      
      return res.status(200).json({
        ok: true,
        signal_id: signal.id,
      });
    } catch (error) {
      console.error('Signal ingest error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'GET') {
    try {
      const { status, limit = 50 } = req.query;
      
      let filtered = signals;
      if (status) {
        filtered = signals.filter(s => s.status === status);
      }
      
      return res.status(200).json({
        ok: true,
        signals: filtered.slice(0, parseInt(limit)),
        total: signals.length,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
