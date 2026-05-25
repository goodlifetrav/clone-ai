import { NextRequest, NextResponse } from 'next/server'
import { getAuth, getSession } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'

export async function GET() {
  try {
    const { userId } = await getAuth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()

    // Look up the current user by clerk_id, then collect ALL user records
    // sharing the same email. The signup flow has historically created multiple
    // user rows for the same email (different clerk_id values across Whop
    // sessions), and projects can be split across them. Aggregating by email
    // re-unifies the user's clone history into one dashboard.
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

    if (userIds.length === 0) {
      return NextResponse.json({ projects: [] })
    }

    // List view: exclude html_content (can be 5MB+ per row on heavy clones).
    // With 100+ projects this turns the response into hundreds of MB and the
    // dashboard times out or hangs. Individual project fetches still hydrate
    // html_content via /api/projects/[id].
    const { data: projects, error } = await supabase
      .from('projects')
      .select('id,user_id,name,url,thumbnail_url,status,clone_method,folder_id,created_at,updated_at')
      .in('user_id', userIds)
      .order('updated_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ projects: projects || [] })
  } catch (err) {
    console.error('Projects GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await getAuth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const supabase = createServiceClient()

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_id', userId)
      .single()

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const { data: project, error } = await supabase
      .from('projects')
      .insert({ ...body, user_id: user.id })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ project })
  } catch (err) {
    console.error('Projects POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
