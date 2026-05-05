import Stripe from 'stripe'

// Use a placeholder key when the env var is missing so the module loads
// without throwing. Routes that call stripe.* will get a clear auth error
// from the Stripe API rather than a silent module-import crash.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'missing_stripe_key')

export const PRICE_IDS = {
  pro: {
    monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID!,
    annual: process.env.STRIPE_PRO_ANNUAL_PRICE_ID!,
  },
  agency: {
    monthly: process.env.STRIPE_AGENCY_MONTHLY_PRICE_ID!,
    annual: process.env.STRIPE_AGENCY_ANNUAL_PRICE_ID!,
  },
}

export const PLAN_PRICES = {
  free: 0,
  pro: 19,
  agency: 49,
}
