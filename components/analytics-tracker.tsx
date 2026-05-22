'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export function AnalyticsTracker() {
  const pathname = usePathname()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    // Persist UTM params for the session so they survive page navigation
    const keys = ['utm_source', 'utm_medium', 'utm_campaign'] as const
    keys.forEach((k) => {
      const val = params.get(k)
      if (val) sessionStorage.setItem(k, val)
    })

    const utm_source = params.get('utm_source') ?? sessionStorage.getItem('utm_source') ?? undefined
    const utm_medium = params.get('utm_medium') ?? sessionStorage.getItem('utm_medium') ?? undefined
    const utm_campaign = params.get('utm_campaign') ?? sessionStorage.getItem('utm_campaign') ?? undefined

    fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'page_view',
        page: pathname,
        referrer: document.referrer || undefined,
        utm_source,
        utm_medium,
        utm_campaign,
      }),
    }).catch(() => {})
  }, [pathname])

  return null
}
