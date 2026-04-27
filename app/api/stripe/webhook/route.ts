import { NextRequest, NextResponse } from 'next/server'
import { stripe, PRICE_IDS } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase'
import type Stripe from 'stripe'
import type { Plan } from '@/types'

// Reverse map: price ID → plan name, built at module load time
function buildPriceToplan(): Record<string, Plan> {
  const map: Record<string, Plan> = {}
  for (const [plan, priceId] of Object.entries(PRICE_IDS)) {
    if (priceId && !priceId.includes('_id_here')) {
      map[priceId] = plan as Plan
    }
  }
  return map
}
const PRICE_TO_PLAN = buildPriceToplan()

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

        if (!clerkId || !plan) {
          console.error('checkout.session.completed: missing clerk_id or plan in metadata', {
            sessionId: session.id,
            metadata: session.metadata,
          })
          break
        }

        // Update plan and reset clones_count when upgrading from free
        const { error: planError, count } = await supabase
          .from('users')
          .update({ plan, clones_count: 0 })
          .eq('clerk_id', clerkId)

        if (planError) {
          console.error('checkout.session.completed: failed to update user plan', {
            clerkId,
            plan,
            error: planError,
          })
          break
        }

        if (count === 0) {
          console.error('checkout.session.completed: no user row matched clerk_id', { clerkId })
          break
        }

        console.log('checkout.session.completed: plan updated', { clerkId, plan })

        // Upsert billing record — onConflict: 'user_id' ensures we update
        // rather than insert a duplicate row on re-subscribe
        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('clerk_id', clerkId)
          .single()

        if (user) {
          const { error: billingError } = await supabase
            .from('billing')
            .upsert(
              {
                user_id: user.id,
                stripe_subscription_id: session.subscription as string,
                plan,
                status: 'active',
              },
              { onConflict: 'user_id' }
            )

          if (billingError) {
            console.error('checkout.session.completed: billing upsert failed', billingError)
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

        if (!user) {
          console.error('customer.subscription.updated: no user found for customer', { customerId })
          break
        }

        // Map subscription status to a value we store.
        // past_due still has access — keep the plan active, just flag the status.
        const stripeStatus = subscription.status
        const billingStatus =
          stripeStatus === 'active' || stripeStatus === 'trialing' || stripeStatus === 'past_due'
            ? stripeStatus
            : 'inactive'

        // Derive the plan from the first subscription item's price ID
        const priceId = subscription.items.data[0]?.price?.id
        const newPlan: Plan | null = priceId ? (PRICE_TO_PLAN[priceId] ?? null) : null

        // Always update billing status
        const { error: billingError } = await supabase
          .from('billing')
          .update({ status: billingStatus, ...(newPlan ? { plan: newPlan } : {}) })
          .eq('user_id', user.id)

        if (billingError) {
          console.error('customer.subscription.updated: billing update failed', billingError)
        }

        // Update users.plan if we can resolve the price ID to a known plan
        if (newPlan) {
          const { error: planError } = await supabase
            .from('users')
            .update({ plan: newPlan })
            .eq('id', user.id)

          if (planError) {
            console.error('customer.subscription.updated: user plan update failed', planError)
          } else {
            console.log('customer.subscription.updated: plan updated', {
              customerId,
              priceId,
              newPlan,
              billingStatus,
            })
          }
        } else {
          console.warn('customer.subscription.updated: could not map price to plan', {
            customerId,
            priceId,
          })
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

        if (!user) {
          console.error('customer.subscription.deleted: no user found for customer', { customerId })
          break
        }

        // Downgrade to free
        const { error: planError } = await supabase
          .from('users')
          .update({ plan: 'free' })
          .eq('id', user.id)

        if (planError) {
          console.error('customer.subscription.deleted: user downgrade failed', planError)
        }

        const { error: billingError } = await supabase
          .from('billing')
          .update({ status: 'canceled', plan: 'free' })
          .eq('user_id', user.id)

        if (billingError) {
          console.error('customer.subscription.deleted: billing update failed', billingError)
        } else {
          console.log('customer.subscription.deleted: user downgraded to free', { customerId })
        }
        break
      }

      default:
        break
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('Webhook handler error:', err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
