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
# Baking the browser into the image means:
#   - No download on container start → instant startup
#   - startup.sh's cache-check always passes and is a no-op
#   - No volume mount needed (a volume at the same path would shadow these files)
RUN npx playwright install chromium --with-deps

COPY startup.sh ./
RUN chmod +x startup.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000
CMD ["sh", "startup.sh"]
