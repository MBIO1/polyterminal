import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const dropletIp = Deno.env.get('DROPLET_IP');
    const dropletSecret = Deno.env.get('DROPLET_SECRET');
    const bybitApiKey = Deno.env.get('BYBIT_API_KEY');
    const bybitApiSecret = Deno.env.get('BYBIT_API_SECRET');
    const bybitTestnet = Deno.env.get('BYBIT_TESTNET');
    const orderServerPort = Deno.env.get('ORDER_SERVER_PORT') || '4001';
    const baseUrl = Deno.env.get('BASE44_APP_URL');
    const userToken = Deno.env.get('BASE44_USER_TOKEN');

    if (!dropletIp || !dropletSecret || !bybitApiKey || !bybitApiSecret) {
      return Response.json({ error: 'Missing required secrets' }, { status: 500 });
    }

    // Prepare deployment payload
    const deploymentScript = `#!/bin/bash
set -e

# Install Node.js if not present
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Create app directory
sudo mkdir -p /opt/arb-bot
cd /opt/arb-bot

# Create .env file
sudo tee .env > /dev/null << 'ENVEOF'
DROPLET_SECRET=${dropletSecret}
BYBIT_API_KEY=${bybitApiKey}
BYBIT_API_SECRET=${bybitApiSecret}
BYBIT_TESTNET=${bybitTestnet || 'false'}
ORDER_SERVER_PORT=${orderServerPort}
BASE44_RESULT_URL=${baseUrl}/functions/ingestTradeResult
BASE44_USER_TOKEN=${userToken}
ENVEOF

# Create order-server.mjs
sudo tee order-server.mjs > /dev/null << 'SCRIPTEOF'
${await getOrderServerCode()}
SCRIPTEOF

# Install dependencies
sudo npm init -y > /dev/null 2>&1 || true
sudo npm install ws dotenv --save > /dev/null 2>&1

# Create systemd service
sudo tee /etc/systemd/system/order-server.service > /dev/null << 'SERVICEEOF'
[Unit]
Description=Order Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/arb-bot
ExecStart=/usr/bin/node order-server.mjs
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICEEOF

# Start service
sudo systemctl daemon-reload
sudo systemctl enable order-server
sudo systemctl start order-server

echo "Order server deployed and running"
`;

    // Encode script as base64 for safe transmission
    const scriptB64 = btoa(deploymentScript);

    // Call droplet's setup endpoint (requires a setup receiver on droplet)
    // For now, return the script for manual execution or setup
    return Response.json({
      status: 'ready',
      dropletIp,
      script: deploymentScript,
      note: 'Script ready for manual execution or automated delivery',
      instructions: [
        'Option 1: Paste script into droplet terminal',
        'Option 2: Use DigitalOcean API with cloud-init',
        'Option 3: Set up HTTP endpoint on droplet to receive deployment'
      ]
    });
  } catch (error) {
    return Response.json({ 
      error: error.message || 'Deployment failed'
    }, { status: 500 });
  }
});

async function getOrderServerCode() {
  // Return the order-server.mjs code
  // In production, fetch from your repo or embed directly
  return `// order-server.mjs placeholder - use code from droplet-bot/order-server.mjs`;
}