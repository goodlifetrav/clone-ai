import Stripe from 'stripe'

// Use a placeholder key when the env var is missing so the module loads
// without throwing. Routes that call stripe.* will get a clear auth error
// from the Stripe API rather than a silent module-import crash.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'missing_stripe_key')

export const PRICE_IDS = {
  starter: process.env.STRIPE_STARTER_PRICE_ID!,
  pro: process.env.STRIPE_PRO_PRICE_ID!,
  growth: process.env.STRIPE_GROWTH_PRICE_ID!,
  max: process.env.STRIPE_MAX_PRICE_ID!,
}

export const PLAN_PRICES = {
  free: 0,
  starter: 10,
  pro: 25,
  growth: 50,
  max: 100,
}
