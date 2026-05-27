import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { stripe, PRICE_IDS } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase'
import type { Plan } from '@/types'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { plan, billingPeriod } = await request.json() as { plan: Plan; billingPeriod?: string }

    if (!plan || plan === 'free') {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const period = billingPeriod === 'annual' ? 'annual' : 'monthly'
    const priceId = PRICE_IDS[plan as keyof typeof PRICE_IDS]?.[period]
    if (!priceId) {
      return NextResponse.json({ error: `Price not configured for: ${plan} ${period}` }, { status: 503 })
    }

    const supabase = createServiceClient()
    const { data: user } = await supabase
      .from('users')
      .select('id, email, stripe_customer_id')
      .eq('clerk_id', userId)
      .single()

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Get or create Stripe customer
    let customerId = user.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { clerk_id: userId },
      })
      customerId = customer.id
      await supabase.from('users').update({ stripe_customer_id: customerId }).eq('clerk_id', userId)
    }

    const origin = request.headers.get('origin') ?? 'https://igualai.com'
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${origin}/dashboard?upgraded=1`,
      cancel_url: `${origin}/pricing`,
      metadata: { clerk_id: userId, plan },
      allow_promotion_codes: true,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Stripe checkout error:', err)
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }
}
