import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const { event_type, page, referrer, utm_source, utm_medium, utm_campaign, user_id } =
      await request.json()

    const supabase = createServiceClient()
    await supabase.from('analytics_events').insert({
      event_type,
      page: page ?? null,
      referrer: referrer ?? null,
      utm_source: utm_source ?? null,
      utm_medium: utm_medium ?? null,
      utm_campaign: utm_campaign ?? null,
      user_id: user_id ?? null,
    })
  } catch { /* silently fail — analytics must never break the app */ }

  return NextResponse.json({ ok: true })
}
