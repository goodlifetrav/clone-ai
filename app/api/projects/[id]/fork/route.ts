import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { isAdminEmail } from '@/lib/admin'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const supabase = createServiceClient()

    // Get user
    const { data: user } = await supabase
      .from('users')
      .select('id, plan, email, is_admin')
      .eq('clerk_id', userId)
      .single()

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Gate Fork behind a paid plan — admins exempt.
    const isAdmin = user.is_admin || isAdminEmail(user.email)
    if (!isAdmin && user.plan === 'free') {
      return NextResponse.json(
        { error: 'Fork requires Pro or higher.', upgradeUrl: '/pricing?from=fork' },
        { status: 402 }
      )
    }

    // Get original project — must belong to the caller. Fork is meant to
    // duplicate your own project, not to copy arbitrary users' html_content.
    const { data: original } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!original) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Create fork
    const { data: fork, error } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        name: `${original.name} (Fork)`,
        url: original.url,
        thumbnail_url: original.thumbnail_url,
        html_content: original.html_content,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Create initial version for fork
    await supabase.from('project_versions').insert({
      project_id: fork.id,
      html_content: original.html_content,
      version_number: 1,
    })

    return NextResponse.json({ project: fork })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
