#!/bin/sh
set -e

# Playwright stores browsers under PLAYWRIGHT_BROWSERS_PATH or the default cache dir.
CACHE_DIR="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"

if ! ls "$CACHE_DIR"/chromium-* >/dev/null 2>&1; then
  echo "[startup] Playwright Chromium not found — installing..."
  npx playwright install chromium --with-deps
  echo "[startup] Playwright Chromium installed."
else
  echo "[startup] Playwright Chromium already installed — skipping."
fi

exec node server.js
