// Vercel Serverless Function: Get Heartbeats
// Route: /api/heartbeat
// Method: GET

// In-memory storage for now (will use database in production)
let heartbeats = [];
const MAX_STORED = 100;

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    // Store heartbeat
    try {
      const data = req.body;
      heartbeats.unshift({
        ...data,
        received_at: new Date().toISOString(),
      });
      
      // Keep only last 100
      if (heartbeats.length > MAX_STORED) {
        heartbeats = heartbeats.slice(0, MAX_STORED);
      }
      
      return res.status(200).json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'GET') {
    // Return latest heartbeats
    const latest = heartbeats[0];
    const oneHourAgo = new Date(Date.now() - 3600000);
    
    const recentHeartbeats = heartbeats.filter(h => 
      new Date(h.snapshot_time) > oneHourAgo
    );
    
    return res.status(200).json({
      ok: true,
      heartbeats: heartbeats.slice(0, 10),
      latest: latest || null,
      count_1h: recentHeartbeats.length,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
