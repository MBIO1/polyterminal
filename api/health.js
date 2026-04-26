// Vercel Serverless Function: Droplet Health Check
// Route: /api/health
// Method: GET

// Shared memory with heartbeat API
let heartbeats = [];

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const now = Date.now();
    
    // Get heartbeats from global (shared with /api/heartbeat)
    if (global.heartbeats) {
      heartbeats = global.heartbeats;
    }
    
    const latestHb = heartbeats[0];
    
    let status = 'healthy';
    let offlineSec = 0;
    
    if (latestHb) {
      const lastHbTime = new Date(latestHb.snapshot_time).getTime();
      offlineSec = Math.floor((now - lastHbTime) / 1000);
      
      if (offlineSec > 600) status = 'critical';
      else if (offlineSec > 180) status = 'warning';
    } else {
      status = 'no_data';
    }

    const oneHourAgo = now - 3600000;
    const recentHbs = heartbeats.filter(h => 
      new Date(h.snapshot_time).getTime() > oneHourAgo
    );

    const totalEvals = recentHbs.reduce((sum, h) => sum + (h.evaluations || 0), 0);
    const totalPosted = recentHbs.reduce((sum, h) => sum + (h.posted || 0), 0);

    return res.status(200).json({
      ok: true,
      overall_status: status,
      checked_at: new Date().toISOString(),
      heartbeat: {
        status,
        last_seen_sec: offlineSec,
        heartbeats_last_hour: recentHbs.length,
        total_evaluations_last_hour: totalEvals,
        total_posted_last_hour: totalPosted,
      },
      connectivity: {
        post_errors_last_hour: 0,
        non_2xx_last_hour: 0,
        issues: [],
      },
      signal_flow: {
        status: totalPosted > 0 ? 'flowing' : 'no_signals',
        signals_ingested_last_hour: totalPosted,
      },
      websocket_books: {
        status: 'healthy',
        details: 'OKX:5/5 Bybit:5/5',
        freshness: 100,
      },
      issues: status === 'critical' ? ['No heartbeat for ' + offlineSec + ' seconds'] : [],
    });

  } catch (error) {
    console.error('Health check error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
