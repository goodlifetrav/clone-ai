import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { createServiceClient } from '@/lib/supabase'

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

async function createGhlContact(email: string, firstName: string, lastName: string) {
  const apiKey = process.env.GHL_API_KEY
  const locationId = process.env.GHL_LOCATION_ID ?? '3rXkjhSCKHbyMoFFgvek'

  if (!apiKey) {
    console.log('[GHL] Skipping — GHL_API_KEY is not set')
    return
  }

  const payload = {
    locationId,
    email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    tags: ['IgualAI Lead', 'Website Cloner'],
  }

  console.log('[GHL] Creating contact:', JSON.stringify(payload))

  let response: Response
  let responseText: string
  try {
    response = await fetch('https://services.leadconnectorhq.com/contacts/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      body: JSON.stringify(payload),
    })
    responseText = await response.text()
  } catch (err) {
    console.error('[GHL] Fetch failed:', err)
    return
  }

  console.log('[GHL] Response status:', response.status)
  console.log('[GHL] Response body:', responseText)

  if (!response.ok) {
    console.error('[GHL] Contact creation failed — status:', response.status, 'body:', responseText)
  } else {
    console.log('[GHL] Contact created successfully')
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

  // Create contact in GHL CRM
  await createGhlContact(email, firstName, lastName)

  return NextResponse.json({ received: true })
}
