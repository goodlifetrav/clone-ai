import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const supabase = createServiceClient()

    // Get user
    const { data: user } = await supabase
      .from('users')
      .select('id, plan')
      .eq('clerk_id', userId)
      .single()

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Check plan allows forking
    if (user.plan === 'free') {
      return NextResponse.json(
        { error: 'Upgrade to Starter or above to fork projects', upgradeRequired: true },
        { status: 403 }
      )
    }

    // Get original project
    const { data: original } = await supabase
      .from('projects')
      .select('*')
      .eq('id', id)
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
