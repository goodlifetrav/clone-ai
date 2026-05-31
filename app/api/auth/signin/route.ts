import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { limit, getClientIp } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  // Credential-stuffing guard: 10 attempts / 15 min per source IP.
  const ip = getClientIp(request)
  const rl = limit(`signin:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 })
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many sign-in attempts. Try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    )
  }

  const { email, password } = await request.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  // Sign in with Supabase Auth using anon key
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  // Ensure user row exists in our DB (upsert in case they were created via Whop before)
  const db = createServiceClient()
  const { data: existingUser } = await db
    .from('users')
    .select('id')
    .eq('clerk_id', data.user.id)
    .single()

  if (!existingUser) {
    await db.from('users').insert({
      clerk_id: data.user.id,
      email: data.user.email,
      name: (data.user.user_metadata?.name as string | undefined) ?? email.split('@')[0],
      plan: 'free',
      tokens_used: 0,
      clones_count: 0,
    })
  }

  // Store in iron-session (same pattern used throughout the app)
  const session = await getSession()
  session.whopUserId = data.user.id
  session.email = data.user.email
  session.name = (data.user.user_metadata?.name as string | undefined) ?? ''
  await session.save()

  return NextResponse.json({ ok: true })
}
