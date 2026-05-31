import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { isAdminEmail } from '@/lib/admin'

function getIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? ''
}

// Looks up the 2-letter country code for an IP via ip-api.com.
// Free tier: 45 req/min from one source IP. No API key required.
// Returns null on any failure (bad IP, network error, rate-limited, etc.) —
// analytics must never break the app, so we fail silent.
async function lookupCountry(ip: string): Promise<string | null> {
  if (!ip) return null
  // Skip private/local IPs that can't be geolocated
  if (/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.|::1$|fe80:)/i.test(ip)) {
    return null
  }
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`,
      { signal: AbortSignal.timeout(3000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (data?.status !== 'success') return null
    return typeof data.countryCode === 'string' && data.countryCode.length === 2
      ? data.countryCode
      : null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    // Intentionally do NOT pull user_id from the request body — that was a
    // spoofing vector that let any caller attribute events to anyone (and
    // poison the admin Signups-by-Source panel). user_id is now derived
    // server-side from the iron-session cookie below.
    const { event_type, page, referrer, utm_source, utm_medium, utm_campaign } =
      await request.json()

    // Skip analytics for admin accounts so my own visits don't pollute the
    // metrics. Two checks because both `users.is_admin` and the static
    // isAdminEmail() allowlist can mark someone as admin.
    const session = await getSession()
    let derivedUserId: string | null = null
    if (session.whopUserId) {
      const supabase = createServiceClient()
      const { data: me } = await supabase
        .from('users')
        .select('id, is_admin, email')
        .eq('clerk_id', session.whopUserId)
        .single()
      if (me?.is_admin || isAdminEmail(me?.email) || isAdminEmail(session.email)) {
        return NextResponse.json({ ok: true, skipped: 'admin' })
      }
      derivedUserId = me?.id ?? null
    }

    const ip = getIp(request)
    const country = await lookupCountry(ip)

    // [GEO-DEBUG] keep one line of diagnostic so we can verify the proxy
    // chain is forwarding IPs correctly. Remove once stable.
    console.log(`[GEO-DEBUG] ${JSON.stringify({
      ip: ip || '(empty)',
      country: country || '(null)',
      xff: request.headers.get('x-forwarded-for') || '(none)',
    })}`)

    const supabase = createServiceClient()
    await supabase.from('analytics_events').insert({
      event_type,
      page: page ?? null,
      referrer: referrer ?? null,
      utm_source: utm_source ?? null,
      utm_medium: utm_medium ?? null,
      utm_campaign: utm_campaign ?? null,
      user_id: derivedUserId,
      country,
    })
  } catch { /* silently fail — analytics must never break the app */ }

  return NextResponse.json({ ok: true })
}
