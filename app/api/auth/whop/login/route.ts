import { NextRequest, NextResponse } from 'next/server'
import { getWhopOAuthUrl } from '@/lib/whop'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://igualai.com'
  const redirectUri = `${appUrl}/api/auth/whop/callback`
  const authUrl = getWhopOAuthUrl(redirectUri)

  const next = request.nextUrl.searchParams.get('next') ?? '/dashboard'
  const popup = request.nextUrl.searchParams.get('popup') === '1'

  const response = NextResponse.redirect(authUrl)
  response.cookies.set('whop_auth_next', next, {
    httpOnly: true,
    maxAge: 60 * 10,
    path: '/',
    sameSite: 'lax',
  })
  if (popup) {
    response.cookies.set('whop_auth_popup', '1', {
      httpOnly: true,
      maxAge: 60 * 10,
      path: '/',
      sameSite: 'lax',
    })
  }

  return response
}
