#!/usr/bin/env bash
# deploy.sh — zero-downtime deployment for clone-ai
#
# Install on the server:
#   chmod +x /var/www/clone-app/deploy.sh
#   /var/www/clone-app/deploy.sh
#
# Strategy:
#   1. Pull latest code from GitHub
#   2. Build new Docker image — old container keeps serving traffic during build
#   3. If the build fails → abort immediately; old container is untouched
#   4. If the build succeeds → swap to new container (gap is start/stop time only)
#   5. Wait for the new container to be running (+ healthy if HEALTHCHECK is set)
#   6. Prune dangling images left by the previous build

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
APP_DIR="/var/www/clone-app"
COMPOSE_SERVICE="cloneai"
HEALTH_TIMEOUT=120   # max seconds to wait for the container to be healthy
HEALTH_INTERVAL=3    # seconds between health-check polls

# ── Colours ───────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}==>${NC} $*"; }
warn() { echo -e "${YELLOW}WARN:${NC} $*"; }
err()  { echo -e "${RED}ERROR:${NC} $*" >&2; }

# ── 1. Pull latest code ───────────────────────────────────────────────────
log "Pulling latest code..."
cd "$APP_DIR"

if ! git diff --quiet HEAD; then
  warn "Uncommitted local changes detected — they will be overwritten."
fi
git fetch origin
git reset --hard origin/main

# ── 2. Build new image (old container still running) ─────────────────────
log "Building new Docker image..."
log "Old container continues serving traffic during build."

BUILD_LOG=$(mktemp)
if ! docker compose build --no-cache 2>&1 | tee "$BUILD_LOG"; then
  err "Build FAILED. Old container is still running — no disruption to live traffic."
  err "Build output saved to: $BUILD_LOG"
  exit 1
fi
rm -f "$BUILD_LOG"
log "Build succeeded."

# ── 3. Swap to the new container ──────────────────────────────────────────
log "Swapping containers (old → new)..."
docker compose up -d --remove-orphans

# ── 4. Wait for healthy / running ─────────────────────────────────────────
log "Waiting for container to be healthy (timeout: ${HEALTH_TIMEOUT}s)..."
ELAPSED=0

while [ "$ELAPSED" -lt "$HEALTH_TIMEOUT" ]; do
  # Get container ID — re-query each loop because compose recreates it
  CONTAINER_ID=$(docker compose ps -q "$COMPOSE_SERVICE" 2>/dev/null | head -n1)

  if [ -z "$CONTAINER_ID" ]; then
    warn "Container not found yet, retrying..."
    sleep "$HEALTH_INTERVAL"
    ELAPSED=$((ELAPSED + HEALTH_INTERVAL))
    continue
  fi

  STATUS=$(docker inspect --format='{{.State.Status}}' "$CONTAINER_ID" 2>/dev/null || echo "unknown")
  HEALTH=$(docker inspect \
    --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    "$CONTAINER_ID" 2>/dev/null || echo "unknown")

  if [ "$STATUS" = "running" ]; then
    if [ "$HEALTH" = "none" ] || [ "$HEALTH" = "healthy" ]; then
      log "Container is up and running."
      break
    elif [ "$HEALTH" = "unhealthy" ]; then
      err "Container started but reported UNHEALTHY after ${ELAPSED}s."
      err "Recent logs:"
      docker compose logs --tail=30 "$COMPOSE_SERVICE" >&2 || true
      exit 1
    fi
    # Health check is 'starting' — keep waiting
  elif [ "$STATUS" = "restarting" ] || [ "$STATUS" = "created" ]; then
    : # keep waiting
  else
    err "Container entered unexpected state '${STATUS}' after ${ELAPSED}s."
    docker compose logs --tail=30 "$COMPOSE_SERVICE" >&2 || true
    exit 1
  fi

  sleep "$HEALTH_INTERVAL"
  ELAPSED=$((ELAPSED + HEALTH_INTERVAL))
done

if [ "$ELAPSED" -ge "$HEALTH_TIMEOUT" ]; then
  err "Container did not become healthy within ${HEALTH_TIMEOUT}s."
  err "Recent logs:"
  docker compose logs --tail=30 "$COMPOSE_SERVICE" >&2 || true
  exit 1
fi

# ── 5. Clean up dangling images from old build ────────────────────────────
log "Pruning dangling images..."
docker image prune -f 2>/dev/null || true

log "────────────────────────────────────────────"
log "Deployment complete. New version is live."
log "────────────────────────────────────────────"
