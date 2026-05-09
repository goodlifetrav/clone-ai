/**
 * Whop API helpers — auth, membership checks, checkout URLs
 */

const WHOP_API_BASE = 'https://api.whop.com/api/v5'
const APP_ID = process.env.WHOP_APP_ID!
const CLIENT_SECRET = process.env.WHOP_CLIENT_SECRET!
const API_KEY = process.env.WHOP_API_KEY!

export function getWhopOAuthUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid',
  })
  return `https://whop.com/oauth?${params.toString()}`
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token?: string }> {
  // Whop uses form-encoded body for token exchange
  const body = new URLSearchParams({
    code,
    client_id: APP_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })

  const res = await fetch(`${WHOP_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Whop token exchange failed: ${text}`)
  }

  return res.json()
}

export interface WhopUser {
  id: string
  username: string
  email: string
  name?: string
  profile_pic_url?: string
}

export async function getWhopUser(accessToken: string): Promise<WhopUser> {
  const res = await fetch(`${WHOP_API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Whop user fetch failed: ${text}`)
  }

  return res.json()
}

export interface WhopMembership {
  id: string
  status: 'active' | 'expired' | 'canceled' | 'trialing'
  plan?: { id: string; product_id: string }
  product?: { id: string }
}

export async function getWhopMemberships(accessToken: string): Promise<WhopMembership[]> {
  const res = await fetch(`${WHOP_API_BASE}/me/memberships`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) return []

  const data = await res.json()
  return data.data ?? []
}

/** Map a Whop product ID to our internal plan name */
export function productIdToPlan(productId: string): string | null {
  const map: Record<string, string> = {
    [process.env.WHOP_FREE_PRODUCT_ID ?? '']: 'free',
    [process.env.WHOP_PRO_PLAN_ID ?? '']: 'pro',
    [process.env.WHOP_AGENCY_PLAN_ID ?? '']: 'agency',
  }
  return map[productId] ?? null
}

/** Resolve user's active plan from their memberships */
export function resolvePlan(memberships: WhopMembership[]): string {
  for (const m of memberships) {
    if (m.status !== 'active' && m.status !== 'trialing') continue
    const productId = m.plan?.product_id ?? m.product?.id ?? ''
    const plan = productIdToPlan(productId)
    if (plan) return plan
  }
  return 'free'
}

/** Checkout URL for a given product or plan ID */
export function getCheckoutUrl(productId: string): string {
  return `https://whop.com/checkout/${productId}/?redirect_url=${encodeURIComponent('https://igualai.com/dashboard')}`
}

/** Verify a Whop webhook signature (HMAC-SHA256) */
export async function verifyWhopWebhook(
  body: string,
  signature: string | null
): Promise<boolean> {
  const secret = process.env.WHOP_WEBHOOK_SECRET
  if (!secret || !signature) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )

  const [algo, sigHex] = signature.split('=')
  if (algo !== 'sha256' || !sigHex) return false

  const sigBytes = Uint8Array.from(sigHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)))

  return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(body))
}

/** Server-to-server: look up a user's membership by Whop user ID using company API key */
export async function getMembershipsByUserId(whopUserId: string): Promise<WhopMembership[]> {
  const res = await fetch(
    `${WHOP_API_BASE}/memberships?user_id=${whopUserId}&status=active`,
    { headers: { Authorization: `Bearer ${API_KEY}` } }
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.data ?? []
}
