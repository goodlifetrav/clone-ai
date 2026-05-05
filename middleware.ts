import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const APP_HOSTS = ['igualai.com', 'www.igualai.com', 'localhost']

function isAppHost(host: string): boolean {
  const hostname = host.split(':')[0] // strip port
  return APP_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))
}

export default clerkMiddleware((auth, request: NextRequest) => {
  const host = request.headers.get('host') ?? ''

  if (!isAppHost(host)) {
    // Custom domain — rewrite to the serve-domain handler
    const url = request.nextUrl.clone()
    url.pathname = '/api/serve-domain'
    return NextResponse.rewrite(url)
  }

  // Normal app request — Clerk handles auth as usual
  return NextResponse.next()
})

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
