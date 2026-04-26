// Vercel Serverless Function: Heartbeat API
// Route: /api/heartbeat
// Methods: GET, POST

// Use global for persistence across requests
if (!global.heartbeats) {
  global.heartbeats = [];
}
const MAX_STORED = 100;

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

  // POST - Store heartbeat
  if (req.method === 'POST') {
    try {
      const data = req.body;
      
      if (!data.snapshot_time) {
        return res.status(400).json({ error: 'Missing snapshot_time' });
      }

      const heartbeat = {
        ...data,
        received_at: new Date().toISOString(),
      };
      
      global.heartbeats.unshift(heartbeat);
      
      // Keep only last 100
      if (global.heartbeats.length > MAX_STORED) {
        global.heartbeats = global.heartbeats.slice(0, MAX_STORED);
      }
      
      console.log('💓 Heartbeat stored:', data.snapshot_time);
      
      return res.status(200).json({
        ok: true,
        message: 'Heartbeat stored',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error storing heartbeat:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  // GET - Retrieve heartbeats
  if (req.method === 'GET') {
    try {
      const latest = global.heartbeats[0] || null;
      const oneHourAgo = new Date(Date.now() - 3600000);
      
      const recentHeartbeats = global.heartbeats.filter(h => 
        new Date(h.snapshot_time) > oneHourAgo
      );
      
      return res.status(200).json({
        ok: true,
        heartbeats: global.heartbeats.slice(0, 10),
        latest,
        count_1h: recentHeartbeats.length,
      });
    } catch (error) {
      console.error('Error retrieving heartbeats:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
