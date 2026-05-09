import { NextRequest, NextResponse } from 'next/server'

const CALLBACK_URL = 'https://igualai.com/api/auth/google/callback'

export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get('next') ?? '/dashboard'

  const state = Buffer.from(JSON.stringify({ next })).toString('base64')

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  })

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  )
}
