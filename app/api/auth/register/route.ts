import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { sendWelcomeEmail, sendCommunityInviteEmail } from '@/lib/email'
import { limit, getClientIp } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  // Signup-flood guard: 5 registrations / hour per source IP.
  const ip = getClientIp(request)
  const rl = limit(`register:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 })
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many signup attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  const { email, password, name } = await request.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  const db = createServiceClient()

  // Create Supabase Auth user via admin API (email_confirm: true skips email verification)
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    user_metadata: { name: name ?? email.split('@')[0] },
    email_confirm: true,
  })

  if (error || !data.user) {
    const msg = error?.message ?? ''
    if (msg.includes('already registered') || msg.includes('already been registered')) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 400 })
    }
    console.error('[Register] Supabase error:', error)
    return NextResponse.json({ error: 'Failed to create account. Please try again.' }, { status: 500 })
  }

  const userId = data.user.id
  const displayName = (name as string | undefined)?.trim() || email.split('@')[0]

  // Upsert into our public users table
  await db.from('users').upsert(
    {
      clerk_id: userId,
      email,
      name: displayName,
      plan: 'free',
      tokens_used: 0,
      clones_count: 0,
    },
    { onConflict: 'clerk_id' }
  )

  // Non-blocking: welcome email + delayed community invite
  sendWelcomeEmail(email, displayName).catch((err) =>
    console.error('[Register] Welcome email failed (non-critical):', err)
  )
  sendCommunityInviteEmail(email, displayName).catch((err) =>
    console.error('[Register] Community invite email failed (non-critical):', err)
  )

  // Create iron-session so the user is immediately logged in
  const session = await getSession()
  session.whopUserId = userId
  session.email = email
  session.name = displayName
  await session.save()

  return NextResponse.json({ ok: true })
}

