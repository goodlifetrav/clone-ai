import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { getCheckoutUrl } from '@/lib/whop'
import type { Plan } from '@/types'

const WHOP_PLAN_IDS: Record<string, Record<string, string | undefined>> = {
  pro: {
    monthly: process.env.WHOP_PRO_PLAN_ID,
    annual: process.env.WHOP_PRO_ANNUAL_PLAN_ID,
  },
  agency: {
    monthly: process.env.WHOP_AGENCY_PLAN_ID,
    annual: process.env.WHOP_AGENCY_ANNUAL_PLAN_ID,
  },
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { plan, billingPeriod } = await request.json() as { plan: Plan; billingPeriod?: string }

    if (!plan || plan === 'free') {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const period = billingPeriod === 'annual' ? 'annual' : 'monthly'
    const planId = WHOP_PLAN_IDS[plan]?.[period]
    if (!planId) {
      return NextResponse.json(
        { error: `Whop plan ID not configured for: ${plan} ${period}` },
        { status: 503 }
      )
    }

    return NextResponse.json({ url: getCheckoutUrl(planId) })
  } catch (err) {
    console.error('Checkout error:', err)
    return NextResponse.json({ error: 'Failed to create checkout URL' }, { status: 500 })
  }
}
