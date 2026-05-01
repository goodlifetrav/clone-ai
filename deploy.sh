#!/usr/bin/env bash
# deploy.sh — deploy clone-ai with HTTP health-check wait
set -euo pipefail

APP_DIR="/var/www/clone-app"
COMPOSE_SERVICE="cloneai"
HEALTH_URL="http://localhost:3000"
HEALTH_TIMEOUT=60
HEALTH_INTERVAL=2

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
log() { echo -e "${GREEN}==>${NC} $*"; }
err() { echo -e "${RED}ERROR:${NC} $*" >&2; }

cd "$APP_DIR"

# 1. Pull latest code
log "Pulling latest code..."
git pull origin main

# 2. Build Next.js
log "Building Next.js..."
npm run build

# 3. Copy static assets into standalone output
log "Copying static files..."
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public

# 4. Restart container
log "Restarting container..."
docker compose up -d --force-recreate "$COMPOSE_SERVICE"

# 5. Poll until healthy
log "Waiting for ${HEALTH_URL} to return 200 (timeout: ${HEALTH_TIMEOUT}s)..."
ELAPSED=0
until curl -sf -o /dev/null "${HEALTH_URL}"; do
  if [ "$ELAPSED" -ge "$HEALTH_TIMEOUT" ]; then
    err "Site did not respond within ${HEALTH_TIMEOUT}s."
    docker compose logs --tail=30 "$COMPOSE_SERVICE" >&2 || true
    exit 1
  fi
  sleep "$HEALTH_INTERVAL"
  ELAPSED=$((ELAPSED + HEALTH_INTERVAL))
done

log "Deployment complete. Site is live at ${HEALTH_URL}"
