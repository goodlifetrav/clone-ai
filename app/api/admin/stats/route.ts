import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isAdminEmail } from '@/lib/admin'
import { createServiceClient } from '@/lib/supabase'

export async function GET() {
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

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString()

  const [
    { count: totalUsers },
    { count: signupsToday },
    { count: signupsThisWeek },
    { data: planBreakdown },
    { count: clonesTotal },
    { count: clonesThisWeek },
    { count: pageViewsToday },
    { count: pageViewsThisWeek },
    { data: trafficSources },
    { data: recentUsers },
    { data: recentUpgrades },
  ] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    supabase.from('users').select('plan').then(({ data }) => {
      const counts: Record<string, number> = {}
      data?.forEach((u) => { counts[u.plan] = (counts[u.plan] ?? 0) + 1 })
      return { data: counts }
    }),
    supabase.from('projects').select('id', { count: 'exact', head: true }),
    supabase.from('projects').select('id', { count: 'exact', head: true }).gte('created_at', weekStart),
    supabase.from('analytics_events').select('id', { count: 'exact', head: true })
      .eq('event_type', 'page_view').gte('created_at', todayStart),
    supabase.from('analytics_events').select('id', { count: 'exact', head: true })
      .eq('event_type', 'page_view').gte('created_at', weekStart),
    supabase.from('analytics_events').select('utm_source, created_at')
      .eq('event_type', 'page_view').gte('created_at', weekStart).not('utm_source', 'is', null),
    supabase.from('users').select('email, plan, created_at').order('created_at', { ascending: false }).limit(10),
    supabase.from('users').select('email, plan, created_at').not('plan', 'eq', 'free')
      .order('created_at', { ascending: false }).limit(10),
  ])

  // Aggregate traffic sources
  const sourceMap: Record<string, number> = {}
  trafficSources?.forEach((e) => {
    const src = e.utm_source ?? 'direct'
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

  const paidUsers = (planBreakdown?.pro ?? 0) + (planBreakdown?.agency ?? 0)
  const signupToPayConversion = signupsThisWeek && signupsThisWeek > 0
    ? Math.round((paidUsers / (totalUsers ?? 1)) * 100)
    : 0
  const visitToSignupConversion = pageViewsThisWeek && pageViewsThisWeek > 0
    ? Math.round(((signupsThisWeek ?? 0) / pageViewsThisWeek) * 100)
    : 0

  return NextResponse.json({
    users: {
      total: totalUsers ?? 0,
      today: signupsToday ?? 0,
      thisWeek: signupsThisWeek ?? 0,
      plans: planBreakdown ?? {},
      paid: paidUsers,
    },
    clones: {
      total: clonesTotal ?? 0,
      thisWeek: clonesThisWeek ?? 0,
    },
    traffic: {
      pageViewsToday: pageViewsToday ?? 0,
      pageViewsThisWeek: pageViewsThisWeek ?? 0,
      sources,
    },
    conversions: {
      visitToSignup: visitToSignupConversion,
      signupToPaid: signupToPayConversion,
    },
    recentUsers: recentUsers ?? [],
    recentUpgrades: recentUpgrades ?? [],
  })
}
