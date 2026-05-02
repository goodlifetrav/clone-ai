import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/pricing',
  '/preview(.*)',
  '/api/stripe/webhook',
  '/api/webhooks(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
])

const BLOCKED_COUNTRIES = new Set([
  'NG', 'GH', 'BD', 'PK', 'ET', 'TZ', 'UG', 'CM', 'SN',
  'EG', 'KE', 'MM', 'KH', 'LA', 'NP', 'YE', 'SD', 'SO', 'AF',
])

export default clerkMiddleware(async (auth, request) => {
  const { pathname } = request.nextUrl

  // Country check — skip for exempt paths
  if (
    !pathname.startsWith('/not-available') &&
    !pathname.startsWith('/api') &&
    !pathname.startsWith('/_next')
  ) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      null

    if (ip) {
      try {
        const res = await fetch(`https://ipapi.co/${ip}/country/`, {
          signal: AbortSignal.timeout(2000),
        })
        if (res.ok) {
          const country = (await res.text()).trim().toUpperCase()
          if (country.length === 2 && BLOCKED_COUNTRIES.has(country)) {
            return NextResponse.redirect(new URL('/not-available', request.url))
          }
        }
      } catch {
        // fail open — never block on API failure
      }
    }
  }

  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
