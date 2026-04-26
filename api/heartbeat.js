// Vercel Serverless Function: Ingest Heartbeat
// Route: /api/heartbeat
// Method: POST

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-droplet-auth');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = req.body;
    
    // Validate required fields
    if (!data.snapshot_time) {
      return res.status(400).json({ error: 'Missing snapshot_time' });
    }

    // For now, store in memory (will use database later)
    // In production, this would save to Supabase/PostgreSQL
    
    console.log('💓 Heartbeat received:', {
      time: data.snapshot_time,
      evaluations: data.evaluations,
      posted: data.posted,
      memory: data.memory_mb,
    });

    // Return success
    return res.status(200).json({
      ok: true,
      message: 'Heartbeat stored',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error storing heartbeat:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}
