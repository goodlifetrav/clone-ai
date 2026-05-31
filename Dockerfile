# ---- Build stage ----
FROM node:20-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:20-slim AS runner
WORKDIR /app

# Standalone Next.js output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static
COPY --from=builder /app/public           ./public

# Full node_modules needed both for the app and for `npx playwright install`
COPY --from=builder /app/node_modules     ./node_modules

# Install Playwright Chromium + its OS dependencies into the Docker layer.
# Browsers go to a shared path under /opt so the runtime can read them as
# the non-root `node` user regardless of $HOME. apt-get and the chromium
# download both need root, so they run here before the USER switch.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN mkdir -p /opt/playwright \
    && npx playwright install chromium --with-deps \
    && chown -R node:node /opt/playwright /app

COPY --chown=node:node startup.sh ./
RUN chmod +x startup.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Drop root for runtime. A container compromise here lands the attacker
# in an unprivileged user context inside a Playwright-laden image, not
# uid 0.
USER node
EXPOSE 3000
CMD ["sh", "startup.sh"]
