#!/bin/bash
# Run this on the VPS after SSH-ing in: bash deploy.sh
set -e

APP_DIR="/var/www/cloneai"
REPO="https://github.com/YOUR_USERNAME/clone-ai.git"

echo "==> Pulling latest code..."
if [ -d "$APP_DIR/.git" ]; then
  cd $APP_DIR && git pull
else
  git clone $REPO $APP_DIR
  cd $APP_DIR
fi

echo "==> Installing dependencies..."
npm ci --omit=dev

echo "==> Building Next.js..."
npm run build

echo "==> Copying static assets into standalone build..."
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public

echo "==> Installing Playwright browsers..."
npx playwright install chromium --with-deps

echo "==> Restarting app with PM2..."
pm2 startOrRestart ecosystem.config.js --env production
pm2 save

echo "==> Done. App running at http://srv1575473.hstgr.cloud"
