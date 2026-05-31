/**
 * In-memory rate limiter — token-bucket per (route, key) tuple.
 *
 * Single-process: works fine for our current Hostinger setup (one Docker
 * container behind nginx, no horizontal scale). If we ever run multiple
 * instances behind a load balancer, swap this for Upstash Ratelimit — the
 * exported `limit()` signature is intentionally compatible so callers stay
 * unchanged.
 *
 * Limits reset on process restart (i.e. on every deploy). That's an
 * intentional trade-off: simplicity beats persistence here, and an attacker
 * gaming the deploy window costs us little.
 *
 * Hot bucket eviction: a periodic sweep removes expired entries so the Map
 * doesn't grow unbounded under attack.
 */

import type { NextRequest } from 'next/server'

interface Bucket {
  count: number
  resetAt: number
}

const BUCKETS = new Map<string, Bucket>()
const SWEEP_INTERVAL_MS = 60_000
let sweepTimer: NodeJS.Timeout | null = null

function ensureSweep() {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of BUCKETS) {
      if (v.resetAt <= now) BUCKETS.delete(k)
    }
  }, SWEEP_INTERVAL_MS)
  // Don't keep the Node event loop alive on this timer.
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref()
}

export interface RateLimitResult {
  success: boolean
  remaining: number
  resetAt: number
}

/**
 * Consume one token from the bucket identified by `key`. Returns
 * { success: false } once `limit` requests have been made inside the
 * rolling `windowMs` window.
 */
export function limit(
  key: string,
  config: { limit: number; windowMs: number }
): RateLimitResult {
  ensureSweep()
  const now = Date.now()
  const existing = BUCKETS.get(key)
  if (!existing || existing.resetAt <= now) {
    const fresh: Bucket = { count: 1, resetAt: now + config.windowMs }
    BUCKETS.set(key, fresh)
    return { success: true, remaining: config.limit - 1, resetAt: fresh.resetAt }
  }
  if (existing.count >= config.limit) {
    return { success: false, remaining: 0, resetAt: existing.resetAt }
  }
  existing.count += 1
  return {
    success: true,
    remaining: config.limit - existing.count,
    resetAt: existing.resetAt,
  }
}

/** Pull a usable client IP out of the request, falling back to "unknown" so
 * the bucket key never collides across users when proxy headers are missing. */
export function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const real = request.headers.get('x-real-ip')
  if (real) return real
  return 'unknown'
}
