import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { getCheckoutUrl } from '@/lib/whop'

const PLAN_IDS: Record<string, string | undefined> = {
  pro: process.env.WHOP_PRO_PLAN_ID,
  agency: process.env.WHOP_AGENCY_PLAN_ID,
}

export async function POST(request: NextRequest) {
  const { userId } = await getAuth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await request.json() as { plan: string }

  const planId = PLAN_IDS[plan]
  if (!planId) {
    return NextResponse.json(
      { error: `Plan ID not configured for: ${plan}. Set WHOP_${plan.toUpperCase()}_PLAN_ID in env.` },
      { status: 503 }
    )
  }

  return NextResponse.json({ url: getCheckoutUrl(planId) })
}
