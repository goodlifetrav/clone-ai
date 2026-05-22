import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isAdminEmail } from '@/lib/admin'
import { createServiceClient } from '@/lib/supabase'

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

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100)
  const statusFilter = request.nextUrl.searchParams.get('status') // 'complete' | 'error' | null = all

  let projectsQuery = supabase
    .from('projects')
    .select('id, user_id, name, url, status, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (statusFilter) {
    projectsQuery = projectsQuery.eq('status', statusFilter)
  }

  const { data: projects } = await projectsQuery

  if (!projects?.length) return NextResponse.json([])

  // Batch-fetch user emails for all projects
  const userIds = [...new Set(projects.map((p) => p.user_id))]
  const { data: users } = await supabase
    .from('users')
    .select('id, email, plan')
    .in('id', userIds)

  const userMap: Record<string, { email: string; plan: string }> = {}
  users?.forEach((u) => { userMap[u.id] = { email: u.email, plan: u.plan } })

  const result = projects.map((p) => ({
    id: p.id,
    url: p.url,
    name: p.name,
    status: p.status,
    created_at: p.created_at,
    email: userMap[p.user_id]?.email ?? 'unknown',
    plan: userMap[p.user_id]?.plan ?? 'free',
  }))

  return NextResponse.json(result)
}
