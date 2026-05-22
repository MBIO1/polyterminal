#!/bin/bash
set -e

DROPLET_IP="165.245.223.144"
DROPLET_USER="root"
REMOTE_DIR="/root/mbio-arb-bot"

echo "🚀 Deploying MBIO Arb Bot to droplet..."

# Copy files to droplet
echo "📦 Syncing files..."
scp bot/order-server.mjs ${DROPLET_USER}@${DROPLET_IP}:${REMOTE_DIR}/
scp bot/bot.mjs ${DROPLET_USER}@${DROPLET_IP}:${REMOTE_DIR}/
scp bot/package.json ${DROPLET_USER}@${DROPLET_IP}:${REMOTE_DIR}/

# Restart services
echo "🔄 Restarting services..."
ssh ${DROPLET_USER}@${DROPLET_IP} << 'ENDSSH'
cd /root/mbio-arb-bot
npm install --production
pm2 restart order-server --update-env
pm2 restart arb-bot --update-env
pm2 save
sleep 2
pm2 status
ENDSSH

echo "✅ Deployment complete!"