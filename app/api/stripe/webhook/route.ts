import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase'
import type Stripe from 'stripe'
import type { Plan } from '@/types'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createServiceClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const clerkId = session.metadata?.clerk_id
        const plan = session.metadata?.plan as Plan

        if (clerkId && plan) {
          await supabase
            .from('users')
            .update({ plan })
            .eq('clerk_id', clerkId)

          // Upsert billing record
          const { data: user } = await supabase
            .from('users')
            .select('id')
            .eq('clerk_id', clerkId)
            .single()

          if (user) {
            await supabase.from('billing').upsert({
              user_id: user.id,
              stripe_subscription_id: session.subscription as string,
              plan,
              status: 'active',
            })
          }
        }
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (user) {
          const status = subscription.status === 'active' ? 'active' : 'inactive'
          await supabase
            .from('billing')
            .update({ status })
            .eq('user_id', user.id)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (user) {
          // Downgrade to free
          await supabase
            .from('users')
            .update({ plan: 'free' })
            .eq('id', user.id)

          await supabase
            .from('billing')
            .update({ status: 'canceled', plan: 'free' })
            .eq('user_id', user.id)
        }
        break
      }

      default:
        // Ignore other events
        break
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('Webhook handler error:', err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
