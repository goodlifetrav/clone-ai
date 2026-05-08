import { NextRequest, NextResponse } from 'next/server'
import { stripe, PRICE_IDS } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase'
import type Stripe from 'stripe'
import type { Plan } from '@/types'

// Reverse map: price ID → plan name, built at module load time
function buildPriceToPlan(): Record<string, Plan> {
  const map: Record<string, Plan> = {}
  for (const [plan, periods] of Object.entries(PRICE_IDS)) {
    for (const priceId of Object.values(periods)) {
      if (priceId && !priceId.includes('_id_here')) {
        map[priceId] = plan as Plan
      }
    }
  }
  return map
}
const PRICE_TO_PLAN = buildPriceToPlan()


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

        if (!clerkId) {
          console.error('checkout.session.completed: missing clerk_id in metadata', {
            sessionId: session.id,
          })
          break
        }

        // ── Token pack purchase ───────────────────────────────────────────
        const tokenPack = session.metadata?.tokenPack
        if (tokenPack) {
          const TOKEN_PACK_AMOUNTS: Record<string, number> = {
            small: 30000,
            medium: 70000,
            large: 200000,
          }
          const tokensToAdd = TOKEN_PACK_AMOUNTS[tokenPack]
          if (!tokensToAdd) {
            console.error('checkout.session.completed: unknown tokenPack', { tokenPack })
            break
          }

          const { data: userData } = await supabase
            .from('users')
            .select('tokens_used')
            .eq('clerk_id', clerkId)
            .single()

          const current = userData?.tokens_used ?? 0
          await supabase
            .from('users')
            .update({ tokens_used: Math.max(0, current - tokensToAdd) })
            .eq('clerk_id', clerkId)

          console.log('checkout.session.completed: tokens granted', { clerkId, tokenPack, tokensToAdd })
          break
        }

        // ── Subscription upgrade ──────────────────────────────────────────
        const plan = session.metadata?.plan as Plan

        if (!plan) {
          console.error('checkout.session.completed: missing plan in metadata', {
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

        // Upsert billing record
        const { data: user } = await supabase
          .from('users')
          .select('id, email')
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

        const stripeStatus = subscription.status
        const billingStatus =
          stripeStatus === 'active' || stripeStatus === 'trialing' || stripeStatus === 'past_due'
            ? stripeStatus
            : 'inactive'

        const priceId = subscription.items.data[0]?.price?.id
        const newPlan: Plan | null = priceId ? (PRICE_TO_PLAN[priceId] ?? null) : null

        const { error: billingError } = await supabase
          .from('billing')
          .update({ status: billingStatus, ...(newPlan ? { plan: newPlan } : {}) })
          .eq('user_id', user.id)

        if (billingError) {
          console.error('customer.subscription.updated: billing update failed', billingError)
        }

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

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const email = invoice.customer_email

        if (!email) {
          console.warn('invoice.payment_failed: no customer_email on invoice', {
            invoiceId: invoice.id,
          })
          break
        }

        console.log('invoice.payment_failed:', email)
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const email = invoice.customer_email

        if (!email) {
          console.warn('invoice.payment_succeeded: no customer_email on invoice', {
            invoiceId: invoice.id,
          })
          break
        }

        console.log('invoice.payment_succeeded:', email)
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
