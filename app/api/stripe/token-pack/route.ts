import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase'

type TokenPack = 'small' | 'medium' | 'large'

const TOKEN_PACK_PRICE_IDS: Record<TokenPack, string | undefined> = {
  small: process.env.STRIPE_TOKEN_SMALL_PRICE_ID,
  medium: process.env.STRIPE_TOKEN_MEDIUM_PRICE_ID,
  large: process.env.STRIPE_TOKEN_LARGE_PRICE_ID,
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: 'Stripe is not configured on this server' }, { status: 503 })
    }

    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { pack } = await request.json() as { pack: TokenPack }

    if (!pack || !TOKEN_PACK_PRICE_IDS[pack]) {
      return NextResponse.json(
        { error: `Price ID not configured for pack: ${pack}. Add to .env.local` },
        { status: 503 }
      )
    }

    const priceId = TOKEN_PACK_PRICE_IDS[pack]!

    const supabase = createServiceClient()

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

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      success_url: `${appUrl}/settings?tokens=true&pack=${pack}`,
      cancel_url: `${appUrl}/settings`,
      metadata: { clerk_id: userId, tokenPack: pack },
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Token pack checkout error:', err)
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }
}
