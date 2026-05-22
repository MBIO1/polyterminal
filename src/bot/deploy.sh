#!/bin/bash
# ─── MBIO Arb Bot Deploy Script ───────────────────────────────────────────────
# Copies bot files to /root/arb-ws-bot/, installs deps, starts with PM2.
# Run from repo root: bash bot/deploy.sh

set -e

BOT_DIR="/root/arb-ws-bot"

echo "📦 Creating bot directory: $BOT_DIR"
mkdir -p "$BOT_DIR"

echo "📋 Copying bot files..."
cp bot/bot.mjs           "$BOT_DIR/bot.mjs"
cp bot/order-server.mjs  "$BOT_DIR/order-server.mjs"
cp bot/package.json      "$BOT_DIR/package.json"

# Copy .env if it exists locally (do not overwrite server's .env)
if [ -f bot/.env ] && [ ! -f "$BOT_DIR/.env" ]; then
  cp bot/.env "$BOT_DIR/.env"
  echo "📄 Copied .env (new file)"
fi

echo "📦 Installing dependencies..."
cd "$BOT_DIR"
npm install --omit=dev

echo "🔄 Restarting PM2 processes..."
pm2 delete order-server 2>/dev/null || true
pm2 delete arb-bot      2>/dev/null || true

pm2 start order-server.mjs --name order-server
pm2 start bot.mjs          --name arb-bot

pm2 save
pm2 list

echo ""
echo "✅ Deploy complete. Testing order-server..."
sleep 1
curl -s http://localhost:4001/health
echo ""