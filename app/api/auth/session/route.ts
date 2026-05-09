import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { sendWelcomeEmail } from '@/lib/email'

export async function POST(request: NextRequest) {
  const { access_token } = await request.json()
  if (!access_token) {
    return NextResponse.json({ error: 'No token' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data: { user }, error } = await db.auth.getUser(access_token)

  if (error || !user) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email?.split('@')[0] ??
    'User'

  // Check if this is a new user
  const { data: existing } = await db.from('users').select('id').eq('clerk_id', user.id).single()

  await db.from('users').upsert(
    {
      clerk_id: user.id,
      email: user.email,
      name: displayName,
      plan: 'free',
      tokens_used: 0,
      clones_count: 0,
    },
    { onConflict: 'clerk_id' }
  )

  // New user → welcome email (non-blocking)
  if (!existing) {
    sendWelcomeEmail(user.email ?? '', displayName).catch((err) =>
      console.error('[Session] Welcome email failed:', err)
    )
  }

  const session = await getSession()
  session.whopUserId = user.id
  session.email = user.email
  session.name = displayName
  await session.save()

  return NextResponse.json({ ok: true })
}

