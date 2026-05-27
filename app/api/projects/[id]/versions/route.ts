import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const supabase = createServiceClient()

    const { data: versions, error } = await supabase
      .from('project_versions')
      .select('*')
      .eq('project_id', id)
      .order('version_number', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ versions: versions || [] })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const { html_content, label } = await request.json()
    const supabase = createServiceClient()

    // Auto-snapshot the original clone before the first user-saved version.
    // The Brand Rebuild route used to do this, but since chat-edits can now
    // happen before rebuild, the "Original Clone" snapshot would get skipped.
    // Doing it here makes "revert to original" available regardless of which
    // editor path the user takes first.
    const { data: existingVersions } = await supabase
      .from('project_versions')
      .select('id, label')
      .eq('project_id', id)
      .limit(5)

    const hasNoVersions = !existingVersions || existingVersions.length === 0
    const hasOriginalLabel = existingVersions?.some(v => v.label === 'Original Clone')

    if (hasNoVersions && !label) {
      // Fetch current saved html_content from the project — this is the
      // pristine clone snapshot before this incoming user-edited version.
      const { data: project } = await supabase
        .from('projects')
        .select('html_content')
        .eq('id', id)
        .single()
      if (project?.html_content && project.html_content !== html_content) {
        await supabase.from('project_versions').insert({
          project_id: id,
          html_content: project.html_content,
          version_number: 1,
          label: 'Original Clone',
        })
      }
    } else if (!hasOriginalLabel && !label) {
      // Existing versions but none labeled Original Clone — backfill from
      // the oldest version we have, since that's the closest thing to the
      // pre-edit state we can recover.
      const { data: oldest } = await supabase
        .from('project_versions')
        .select('id')
        .eq('project_id', id)
        .order('version_number', { ascending: true })
        .limit(1)
        .single()
      if (oldest) {
        await supabase
          .from('project_versions')
          .update({ label: 'Original Clone' })
          .eq('id', oldest.id)
      }
    }

    // Get latest version number AFTER any auto-snapshot insert above
    const { data: latest } = await supabase
      .from('project_versions')
      .select('version_number')
      .eq('project_id', id)
      .order('version_number', { ascending: false })
      .limit(1)
      .single()

    const nextVersion = (latest?.version_number || 0) + 1

    const { data: version, error } = await supabase
      .from('project_versions')
      .insert({
        project_id: id,
        html_content,
        version_number: nextVersion,
        ...(label ? { label } : {}),
      })
      .select()
      .single()

    if (error) {
      console.error('[versions POST] supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ version })
  } catch (err) {
    console.error('[versions POST] exception:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
