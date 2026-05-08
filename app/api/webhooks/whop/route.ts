import { NextRequest, NextResponse } from 'next/server'
import { verifyWhopWebhook, productIdToPlan, getMembershipsByUserId } from '@/lib/whop'
import { createServiceClient } from '@/lib/supabase'
import { ghlFindContactByEmail, ghlAddTags, ghlRemoveTags, planToGhlTag } from '@/lib/ghl'

interface WhopWebhookEvent {
  event: string
  data: {
    user_id?: string
    product_id?: string
    plan?: { product_id: string }
    status?: string
    membership?: { user_id: string; plan?: { product_id: string } }
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('x-whop-signature')

  const isValid = await verifyWhopWebhook(body, signature)
  if (!isValid) {
    console.error('[Whop webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: WhopWebhookEvent
  try {
    event = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  console.log('[Whop webhook] event:', event.event, event.data)

  const supabase = createServiceClient()

  // Extract user ID and product ID from various event shapes
  const whopUserId = event.data.user_id ?? event.data.membership?.user_id
  const productId =
    event.data.product_id ??
    event.data.plan?.product_id ??
    event.data.membership?.plan?.product_id

  if (!whopUserId) {
    return NextResponse.json({ ok: true, skipped: 'no user_id' })
  }

  if (event.event === 'membership.went_valid') {
    // Map product → plan; if unknown product, default to 'pro' (not free)
    const plan = productId ? (productIdToPlan(productId) ?? 'pro') : 'free'

    await supabase.from('users').update({ plan }).eq('clerk_id', whopUserId)

    // Sync GHL tag
    const { data: user } = await supabase
      .from('users')
      .select('email, plan')
      .eq('clerk_id', whopUserId)
      .single()

    if (user?.email) {
      try {
        const contact = await ghlFindContactByEmail(user.email)
        if (contact) {
          const tag = planToGhlTag(plan)
          if (tag) await ghlAddTags(contact.id, [tag])
        }
      } catch (e) {
        console.error('[Whop webhook] GHL sync failed:', e)
      }
    }

    console.log(`[Whop webhook] user ${whopUserId} → plan: ${plan}`)
  }

  if (event.event === 'membership.went_invalid') {
    // Verify no active memberships remain before downgrading
    const memberships = await getMembershipsByUserId(whopUserId)
    const hasActive = memberships.some((m) => m.status === 'active' || m.status === 'trialing')

    if (!hasActive) {
      await supabase.from('users').update({ plan: 'free' }).eq('clerk_id', whopUserId)

      const { data: user } = await supabase
        .from('users')
        .select('email')
        .eq('clerk_id', whopUserId)
        .single()

      if (user?.email) {
        try {
          const contact = await ghlFindContactByEmail(user.email)
          if (contact) {
            await ghlRemoveTags(contact.id, ['igualai_pro', 'igualai_agency'])
          }
        } catch (e) {
          console.error('[Whop webhook] GHL sync failed:', e)
        }
      }

      console.log(`[Whop webhook] user ${whopUserId} → downgraded to free`)
    }
  }

  return NextResponse.json({ ok: true })
}
