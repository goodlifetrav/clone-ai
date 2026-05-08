import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { getCheckoutUrl } from '@/lib/whop'
import type { Plan } from '@/types'

const WHOP_PLAN_IDS: Record<string, string | undefined> = {
  pro: process.env.WHOP_PRO_PLAN_ID,
  agency: process.env.WHOP_AGENCY_PLAN_ID,
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { plan } = await request.json() as { plan: Plan; billingPeriod?: string }

    if (!plan || plan === 'free') {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const planId = WHOP_PLAN_IDS[plan]
    if (!planId) {
      return NextResponse.json(
        { error: `Whop plan ID not configured for: ${plan}. Set WHOP_${plan.toUpperCase()}_PLAN_ID in env.` },
        { status: 503 }
      )
    }

    return NextResponse.json({ url: getCheckoutUrl(planId) })
  } catch (err) {
    console.error('Checkout error:', err)
    return NextResponse.json({ error: 'Failed to create checkout URL' }, { status: 500 })
  }
}
