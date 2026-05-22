import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { sendWelcomeEmail, sendCommunityInviteEmail } from '@/lib/email'
import { sendTelegram } from '@/lib/telegram'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://igualai.com'
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const error = request.nextUrl.searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/?error=google_auth_failed`)
  }

  let next = '/dashboard'
  try {
    if (state) {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString())
      next = decoded.next ?? '/dashboard'
    }
  } catch {}

  try {
    // Exchange code for Google access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: 'https://igualai.com/api/auth/google/callback',
        grant_type: 'authorization_code',
      }),
    })

    const tokens = await tokenRes.json()
    if (!tokens.access_token) {
      throw new Error(`Google token exchange failed: ${JSON.stringify(tokens)}`)
    }

    // Get user profile from Google
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const profile = await profileRes.json()

    if (!profile.email) {
      throw new Error('No email returned from Google profile')
    }

    const db = createServiceClient()
    const displayName = (profile.name as string | undefined) ?? profile.email.split('@')[0]

    // Check if user already exists by email
    const { data: existingUser } = await db
      .from('users')
      .select('id, clerk_id')
      .eq('email', profile.email)
      .single()

    let userId: string

    if (existingUser) {
      userId = existingUser.clerk_id
    } else {
      // New user — create a Supabase Auth user so email/password sign-in works later
      const { data: authData } = await db.auth.admin.createUser({
        email: profile.email,
        user_metadata: { name: displayName, avatar_url: profile.picture ?? null },
        email_confirm: true,
      })
      userId = authData.user?.id ?? `google_${profile.id}`

      await db.from('users').insert({
        clerk_id: userId,
        email: profile.email,
        name: displayName,
        plan: 'free',
        tokens_used: 0,
        clones_count: 0,
      })

      // Non-blocking: welcome email + delayed community invite
      sendTelegram(`🎉 <b>New signup!</b>\n<b>Name:</b> ${displayName}\n<b>Email:</b> ${profile.email}`).catch(() => {})
      sendWelcomeEmail(profile.email, displayName).catch((err) =>
        console.error('[Google OAuth] Welcome email failed:', err)
      )
      sendCommunityInviteEmail(profile.email, displayName).catch((err) =>
        console.error('[Google OAuth] Community invite email failed:', err)
      )
    }

    // Create iron-session
    const session = await getSession()
    session.whopUserId = userId
    session.email = profile.email
    session.name = displayName
    await session.save()

    return NextResponse.redirect(`${appUrl}${next}`)
  } catch (err) {
    console.error('[Google OAuth callback] error:', err)
    return NextResponse.redirect(`${appUrl}/?error=google_auth_failed`)
  }
}

