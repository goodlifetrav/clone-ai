import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { stripe, PRICE_IDS } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase'
import type { Plan } from '@/types'

export async function POST(request: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe is not configured on this server' }, { status: 503 })
    }

    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { plan } = await request.json() as { plan: Plan }

    if (!plan || plan === 'free') {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const priceId = PRICE_IDS[plan as keyof typeof PRICE_IDS]
    if (!priceId) {
      return NextResponse.json(
        { error: `Price ID not configured for plan: ${plan}. Add to .env.local` },
        { status: 503 }
      )
    }

    const supabase = createServiceClient()

    // Get or create user
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('clerk_id', userId)
      .single()

    if (!user) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({ clerk_id: userId, email: '', name: '', plan: 'free' })
        .select()
        .single()
      user = newUser
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    // Create or get Stripe customer
    let customerId = user?.stripe_customer_id

    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { clerk_id: userId },
      })
      customerId = customer.id

      await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('clerk_id', userId)
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${appUrl}/settings?success=true&plan=${plan}`,
      cancel_url: `${appUrl}/pricing?canceled=true`,
      metadata: { clerk_id: userId, plan },
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Checkout error:', err)
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }
}
