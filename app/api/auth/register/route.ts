import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
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

  // Attempt to create Whop free membership (non-blocking — failure doesn't break signup)
  createWhopFreeMembership(email).catch((err) =>
    console.error('[Register] Whop membership creation failed (non-critical):', err)
  )

  // Create iron-session so the user is immediately logged in
  const session = await getSession()
  session.whopUserId = userId
  session.email = email
  session.name = displayName
  await session.save()

  return NextResponse.json({ ok: true })
}

async function createWhopFreeMembership(email: string): Promise<void> {
  const productId = process.env.WHOP_FREE_PRODUCT_ID
  if (!productId) return

  const res = await fetch('https://api.whop.com/api/v5/memberships', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHOP_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ product_id: productId, email }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Whop API ${res.status}: ${text}`)
  }
}
