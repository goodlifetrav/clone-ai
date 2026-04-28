import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { createServiceClient } from '@/lib/supabase'
import { ghlCreateContact } from '@/lib/ghl'

interface ClerkEmailAddress {
  email_address: string
  id: string
}

interface ClerkUserCreatedEvent {
  type: string
  data: {
    id: string
    email_addresses: ClerkEmailAddress[]
    first_name: string | null
    last_name: string | null
  }
}

export async function POST(request: NextRequest) {
  console.log('[Clerk Webhook] Received request')

  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('[Clerk Webhook] CLERK_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  // Verify the webhook signature
  const svixId = request.headers.get('svix-id')
  const svixTimestamp = request.headers.get('svix-timestamp')
  const svixSignature = request.headers.get('svix-signature')

  console.log('[Clerk Webhook] svix-id:', svixId, '| svix-timestamp:', svixTimestamp)

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.error('[Clerk Webhook] Missing svix headers')
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 })
  }

  const body = await request.text()

  let event: ClerkUserCreatedEvent
  try {
    const wh = new Webhook(webhookSecret)
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkUserCreatedEvent
    console.log('[Clerk Webhook] Signature verified. Event type:', event.type)
  } catch (err) {
    console.error('[Clerk Webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 })
  }

  if (event.type !== 'user.created') {
    console.log('[Clerk Webhook] Ignoring event type:', event.type)
    return NextResponse.json({ received: true })
  }

  const { id: clerkId, email_addresses, first_name, last_name } = event.data
  const email = email_addresses?.[0]?.email_address ?? ''
  const firstName = first_name ?? ''
  const lastName = last_name ?? ''
  const name = `${firstName} ${lastName}`.trim()

  console.log('[Clerk Webhook] New user — clerkId:', clerkId, '| email:', email, '| name:', name)

  // Save user to Supabase
  const supabase = createServiceClient()
  const { error } = await supabase.from('users').upsert(
    {
      clerk_id: clerkId,
      email,
      name,
      plan: 'free',
      tokens_used: 0,
      clones_count: 0,
    },
    { onConflict: 'clerk_id' }
  )

  if (error) {
    console.error('[Clerk Webhook] Failed to save user to Supabase:', error)
    return NextResponse.json({ error: 'Failed to save user' }, { status: 500 })
  }

  console.log('[Clerk Webhook] User saved to Supabase successfully')

  // Create contact in GHL — handles duplicate by adding "IgualAI Lead" tag
  await ghlCreateContact(email, firstName, lastName, ['IgualAI Lead', 'Website Cloner'])

  return NextResponse.json({ received: true })
}
