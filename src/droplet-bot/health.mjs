/**
 * Minimal HTTP health server — listens on port 3000
 * Run alongside the main bot: node health.mjs &
 * Or add `import './health.mjs'` at the top of your main bot entry file.
 */

import { createServer } from 'http';

const PORT = process.env.HEALTH_PORT || 3000;
const START_TIME = Date.now();

const server = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    const body = JSON.stringify({
      status: 'ok',
      uptime_sec: Math.floor((Date.now() - START_TIME) / 1000),
      ts: new Date().toISOString(),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🩺 Health server listening on port ${PORT}`);
});