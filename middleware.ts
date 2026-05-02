import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

const BLOCKED_COUNTRIES = new Set([
  'NG', 'GH', 'BD', 'PK', 'ET', 'TZ', 'UG', 'CM', 'SN',
  'EG', 'KE', 'MM', 'KH', 'LA', 'NP', 'YE', 'SD', 'SO', 'AF',
])

async function getCountry(ip: string): Promise<string | null> {
  try {
    const res = await fetch(`https://ipapi.co/${ip}/country/`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return null
    const text = (await res.text()).trim()
    // ipapi.co returns a bare 2-letter code or an error string
    return text.length === 2 ? text.toUpperCase() : null
  } catch {
    return null
  }
}

function getIp(request: NextRequest): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    null
  )
}

const clerk = clerkMiddleware()

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip geo-check for exempted paths
  const skip =
    pathname === '/not-available' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    /\.(?:ico|png|jpg|jpeg|svg|webp|css|js|woff2?)$/.test(pathname)

  if (!skip) {
    const ip = getIp(request)
    if (ip) {
      const country = await getCountry(ip)
      if (country && BLOCKED_COUNTRIES.has(country)) {
        return NextResponse.redirect(new URL('/not-available', request.url))
      }
    }
  }

  return clerk(request, {} as never)
}

export const config = {
  matcher: [
    // Run on all routes except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
