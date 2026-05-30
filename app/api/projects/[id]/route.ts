import { NextRequest, NextResponse } from 'next/server'
import { getAuth, getSession } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'

async function getUserAndProject(userId: string, projectId: string) {
  const supabase = createServiceClient()

  // Email-aggregated lookup: historical signup flow created multiple user
  // rows for the same email. A project may live under any of them, so we
  // accept it as the current user's if its user_id matches ANY user row
  // sharing the current session's email.
  const { data: primaryUser } = await supabase
    .from('users')
    .select('id, email')
    .eq('clerk_id', userId)
    .single()

  let email = primaryUser?.email
  if (!email) {
    const session = await getSession()
    email = session.email
  }

  const userIds: string[] = primaryUser ? [primaryUser.id] : []
  if (email) {
    const { data: siblings } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
    siblings?.forEach((u) => {
      if (!userIds.includes(u.id)) userIds.push(u.id)
    })
  }

  if (userIds.length === 0) return { supabase, user: null, project: null }

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .in('user_id', userIds)
    .single()

  // For writes, the caller still needs ONE user id; primaryUser is preferred.
  const user = primaryUser ?? { id: userIds[0] }
  return { supabase, user, project }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const { project } = await getUserAndProject(userId, id)

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    return NextResponse.json({ project })
  } catch (err) {
    console.error('Project GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const body = await request.json()
    const { supabase, project } = await getUserAndProject(userId, id)

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Whitelist updatable fields. Spreading ...body would let a caller
    // overwrite user_id, status, id, clones_count, or other server-managed
    // columns. Status transitions belong to /api/clone and /api/generate.
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.name === 'string') payload.name = body.name
    if (typeof body.html_content === 'string') payload.html_content = body.html_content
    if (typeof body.thumbnail_url === 'string') payload.thumbnail_url = body.thumbnail_url
    if (typeof body.folder_id === 'string' || body.folder_id === null) {
      payload.folder_id = body.folder_id
    }

    const { data: updated, error } = await supabase
      .from('projects')
      .update(payload)
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ project: updated })
  } catch (err) {
    console.error('Project PUT error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return PUT(request, context)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const { supabase, project } = await getUserAndProject(userId, id)

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const { error } = await supabase.from('projects').delete().eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Project DELETE error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
