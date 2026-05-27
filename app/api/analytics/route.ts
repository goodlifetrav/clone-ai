import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import geoip from 'geoip-lite'

function getIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? ''
}

export async function POST(request: NextRequest) {
  try {
    const { event_type, page, referrer, utm_source, utm_medium, utm_campaign, user_id } =
      await request.json()

    const ip = getIp(request)
    const geo = ip ? geoip.lookup(ip) : null
    const country = geo?.country ?? null

    // [GEO-DEBUG] temporary diagnostic — capture exactly what we're seeing
    // from the proxy chain. Will be removed once geo lookups are working.
    console.log(`[GEO-DEBUG] ${JSON.stringify({
      ip: ip || '(empty)',
      country: country || '(null)',
      xff: request.headers.get('x-forwarded-for') || '(none)',
      xri: request.headers.get('x-real-ip') || '(none)',
      cfip: request.headers.get('cf-connecting-ip') || '(none)',
    })}`)

    const supabase = createServiceClient()
    await supabase.from('analytics_events').insert({
      event_type,
      page: page ?? null,
      referrer: referrer ?? null,
      utm_source: utm_source ?? null,
      utm_medium: utm_medium ?? null,
      utm_campaign: utm_campaign ?? null,
      user_id: user_id ?? null,
      country,
    })
  } catch { /* silently fail — analytics must never break the app */ }

  return NextResponse.json({ ok: true })
}
