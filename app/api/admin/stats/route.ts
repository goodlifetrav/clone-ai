import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isAdminEmail } from '@/lib/admin'
import { createServiceClient } from '@/lib/supabase'

// Always re-query — admin stats should never be cached at the framework level
export const dynamic = 'force-dynamic'

const PLAN_PRICE: Record<string, number> = { pro: 19, agency: 49, max: 99 }
// All "total" counts are anchored to this date — set via LAUNCH_DATE env var
const LAUNCH_DATE = process.env.LAUNCH_DATE ?? '2020-01-01T00:00:00.000Z'

function getPeriodDates(period: string): { start: string; end: string | null } {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (period === 'today') return { start: todayStart.toISOString(), end: null }

  if (period === 'yesterday') {
    const s = new Date(todayStart)
    s.setDate(s.getDate() - 1)
    return { start: s.toISOString(), end: todayStart.toISOString() }
  }

  if (period === '30d') {
    const s = new Date(todayStart)
    s.setDate(s.getDate() - 30)
    return { start: s.toISOString(), end: null }
  }

  // default: 7d
  const s = new Date(todayStart)
  s.setDate(s.getDate() - 7)
  return { start: s.toISOString(), end: null }
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session.whopUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { data: me } = await supabase
    .from('users')
    .select('is_admin, email')
    .eq('clerk_id', session.whopUserId)
    .single()

  if (!me?.is_admin && !isAdminEmail(me?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const period = request.nextUrl.searchParams.get('period') ?? '7d'
  const { start: pStart, end: pEnd } = getPeriodDates(period)

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30).toISOString()

  // Build period-filtered queries inline (avoids TypeScript generic issues)
  const signupsQ = pEnd
    ? supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', pStart).lt('created_at', pEnd)
    : supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', pStart)

  const clonesQ = pEnd
    ? supabase.from('projects').select('id', { count: 'exact', head: true }).gte('created_at', pStart).lt('created_at', pEnd)
    : supabase.from('projects').select('id', { count: 'exact', head: true }).gte('created_at', pStart)

  const analyticsQ = pEnd
    ? supabase.from('analytics_events').select('id', { count: 'exact', head: true }).eq('event_type', 'page_view').gte('created_at', pStart).lt('created_at', pEnd)
    : supabase.from('analytics_events').select('id', { count: 'exact', head: true }).eq('event_type', 'page_view').gte('created_at', pStart)

  // Traffic by source — every visitor page_view that arrived with utm_source
  const sourcesQ = pEnd
    ? supabase.from('analytics_events').select('utm_source').eq('event_type', 'page_view').not('utm_source', 'is', null).gte('created_at', pStart).lt('created_at', pEnd)
    : supabase.from('analytics_events').select('utm_source').eq('event_type', 'page_view').not('utm_source', 'is', null).gte('created_at', pStart)

  // Signups by source — users created in period, joined with their analytics
  // events to find their attribution utm_source. We take the first matching
  // event per user (closest to their landing/signup).
  const signupSourcesUsersQ = pEnd
    ? supabase.from('users').select('id, created_at').gte('created_at', pStart).lt('created_at', pEnd)
    : supabase.from('users').select('id, created_at').gte('created_at', pStart)

  const recentQ = pEnd
    ? supabase.from('users').select('email, plan, created_at, tokens_used, clones_count').gte('created_at', pStart).lt('created_at', pEnd).order('created_at', { ascending: false }).limit(20)
    : supabase.from('users').select('email, plan, created_at, tokens_used, clones_count').gte('created_at', pStart).order('created_at', { ascending: false }).limit(20)

  const countriesQ = pEnd
    ? supabase.from('analytics_events').select('country').eq('event_type', 'page_view').not('country', 'is', null).gte('created_at', pStart).lt('created_at', pEnd)
    : supabase.from('analytics_events').select('country').eq('event_type', 'page_view').not('country', 'is', null).gte('created_at', pStart)

  const [
    { count: totalUsers },
    { count: signupsPeriod },
    { data: allUserPlans },
    { count: clonesTotal },
    { count: clonesPeriod },
    { data: dailySignupsRaw },
    { data: topUsers },
    { data: allPaidUsers },
    { count: visitorsToday },
    { count: visitorsPeriod },
    { data: trafficSources },
    { data: recentUsers },
    { data: countryRows },
    { data: signupSourcesUsers },
  ] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', LAUNCH_DATE),
    signupsQ,
    supabase.from('users').select('plan, tokens_used').gte('created_at', LAUNCH_DATE),
    supabase.from('projects').select('id', { count: 'exact', head: true }).gte('created_at', LAUNCH_DATE),
    clonesQ,
    // Always last 30 days for the chart
    supabase.from('users').select('created_at').gte('created_at', thirtyDaysAgo).order('created_at', { ascending: true }),
    // Top users by token usage — all-time, not filtered by launch date
    supabase.from('users').select('email, plan, tokens_used, clones_count').order('tokens_used', { ascending: false }).limit(20),
    // Paid users — all-time
    supabase.from('users').select('email, plan, created_at, tokens_used').not('plan', 'eq', 'free').order('created_at', { ascending: false }),
    // Analytics — gracefully returns null if table doesn't exist yet
    supabase.from('analytics_events').select('id', { count: 'exact', head: true }).eq('event_type', 'page_view').gte('created_at', todayStart),
    analyticsQ,
    sourcesQ,
    recentQ,
    countriesQ,
    signupSourcesUsersQ,
  ])

  // Signup-source attribution: for each user created in period, find the
  // utm_source from their analytics events. One DB hit, then in-memory join.
  const signupSources: { source: string; count: number; pct: number }[] = []
  if (signupSourcesUsers && signupSourcesUsers.length > 0) {
    const userIds = signupSourcesUsers.map((u) => u.id)
    const { data: attribEvents } = await supabase
      .from('analytics_events')
      .select('user_id, utm_source, created_at')
      .in('user_id', userIds)
      .not('utm_source', 'is', null)
      .eq('event_type', 'page_view')
      .order('created_at', { ascending: true })

    // Take first source per user
    const userToSource: Record<string, string> = {}
    attribEvents?.forEach((e) => {
      const ev = e as { user_id: string; utm_source: string }
      if (ev.user_id && ev.utm_source && !userToSource[ev.user_id]) {
        userToSource[ev.user_id] = ev.utm_source
      }
    })
    const signupSourceMap: Record<string, number> = {}
    for (const src of Object.values(userToSource)) {
      signupSourceMap[src] = (signupSourceMap[src] ?? 0) + 1
    }
    const totalAttribUsers = Object.values(signupSourceMap).reduce((a, b) => a + b, 0)
    Object.entries(signupSourceMap)
      .sort((a, b) => b[1] - a[1])
      .forEach(([source, count]) => {
        signupSources.push({
          source,
          count,
          pct: totalAttribUsers > 0 ? Math.round((count / totalAttribUsers) * 100) : 0,
        })
      })
  }

  // Plan breakdown + MRR
  const plans: Record<string, number> = {}
  let totalTokens = 0
  allUserPlans?.forEach((u) => {
    plans[u.plan] = (plans[u.plan] ?? 0) + 1
    totalTokens += u.tokens_used ?? 0
  })
  const mrr = Object.entries(plans).reduce((sum, [plan, count]) => sum + (PLAN_PRICE[plan] ?? 0) * count, 0)
  const paidCount = Object.entries(plans).filter(([p]) => p !== 'free').reduce((sum, [, c]) => sum + c, 0)

  // 30-day signups chart data
  const dayMap: Record<string, number> = {}
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    dayMap[d.toISOString().slice(0, 10)] = 0
  }
  dailySignupsRaw?.forEach((u) => {
    const key = (u.created_at as string).slice(0, 10)
    if (key in dayMap) dayMap[key]++
  })
  const chartData = Object.entries(dayMap).map(([date, count]) => ({ date, count }))

  // Traffic sources aggregation
  const sourceMap: Record<string, number> = {}
  trafficSources?.forEach((e) => {
    const src = (e as { utm_source: string }).utm_source
    sourceMap[src] = (sourceMap[src] ?? 0) + 1
  })
  const totalSourced = Object.values(sourceMap).reduce((a, b) => a + b, 0)
  const sources = Object.entries(sourceMap)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({
      source,
      count,
      pct: totalSourced > 0 ? Math.round((count / totalSourced) * 100) : 0,
    }))

  // Country aggregation
  const countryMap: Record<string, number> = {}
  countryRows?.forEach((e) => {
    const c = (e as { country: string }).country
    if (c) countryMap[c] = (countryMap[c] ?? 0) + 1
  })
  const countries = Object.entries(countryMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([country, count]) => ({ country, count }))

  // Conversion rates
  const signupToPaid = totalUsers ? Math.round((paidCount / (totalUsers as number)) * 100) : 0
  const visitToSignup =
    (visitorsPeriod ?? 0) > 0
      ? Math.round(((signupsPeriod ?? 0) / (visitorsPeriod as number)) * 100)
      : 0

  return NextResponse.json({
    period,
    users: {
      total: totalUsers ?? 0,
      thisPeriod: signupsPeriod ?? 0,
      plans,
      paid: paidCount,
      mrr,
      totalTokens,
    },
    clones: { total: clonesTotal ?? 0, thisPeriod: clonesPeriod ?? 0 },
    traffic: {
      visitorsToday: visitorsToday ?? 0,
      visitorsPeriod: visitorsPeriod ?? 0,
      sources,
      signupSources,
      countries,
    },
    conversions: { signupToPaid, visitToSignup },
    chartData,
    topUsers: topUsers ?? [],
    allPaidUsers: allPaidUsers ?? [],
    recentUsers: recentUsers ?? [],
  })
}
