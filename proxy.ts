import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getIronSession } from 'iron-session'
import type { SessionData } from '@/lib/auth'

const APP_HOSTS = ['igualai.com', 'www.igualai.com', 'localhost']

function isAppHost(host: string): boolean {
  const hostname = host.split(':')[0]
  return APP_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))
}

const sessionOptions = {
  cookieName: 'igualai_session',
  password: process.env.SESSION_SECRET ?? 'fallback-dev-secret-change-in-production-32chars',
}

const PROTECTED_PATHS = ['/dashboard', '/editor', '/settings']
const AUTH_PATHS = ['/sign-in', '/sign-up']

const BLOCKED_COUNTRIES = new Set([
  'NG', 'GH', 'BD', 'PK', 'ET', 'TZ', 'UG', 'CM', 'SN',
  'EG', 'KE', 'MM', 'KH', 'LA', 'NP', 'YE', 'SD', 'SO', 'AF',
])

export default async function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? ''

  // Custom domain proxying
  if (!isAppHost(host)) {
    const url = request.nextUrl.clone()
    url.pathname = '/api/serve-domain'
    return NextResponse.rewrite(url)
  }

  const { pathname } = request.nextUrl

  // Country block — skip for exempt paths
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

  const isProtected = PROTECTED_PATHS.some((p) => pathname.startsWith(p))
  const isAuthPage = AUTH_PATHS.some((p) => pathname.startsWith(p))

  if (!isProtected && !isAuthPage) return NextResponse.next()

  // Read session
  const res = NextResponse.next()
  const session = await getIronSession<SessionData>(request, res, sessionOptions)
  const isLoggedIn = !!session.whopUserId

  if (isProtected && !isLoggedIn) {
    const loginUrl = new URL('/api/auth/whop/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
