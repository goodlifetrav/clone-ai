import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import type { SessionData } from '@/lib/auth'

const sessionOptions = {
  cookieName: 'igualai_session',
  password: process.env.SESSION_SECRET ?? 'fallback-dev-secret-change-in-production-32chars',
}

// Routes that require authentication
const PROTECTED_PATHS = ['/dashboard', '/editor', '/settings']

// Routes that should redirect to dashboard if already signed in
const AUTH_PATHS = ['/sign-in', '/sign-up']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isProtected = PROTECTED_PATHS.some((p) => pathname.startsWith(p))
  const isAuthPage = AUTH_PATHS.some((p) => pathname.startsWith(p))

  if (!isProtected && !isAuthPage) return NextResponse.next()

  // Read session — iron-session v8 middleware form uses (req, res, options)
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
  matcher: ['/dashboard/:path*', '/editor/:path*', '/settings/:path*', '/sign-in', '/sign-up'],
}
