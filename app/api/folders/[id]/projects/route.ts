import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const supabase = createServiceClient()

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_id', userId)
      .single()

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Verify folder belongs to user
    const { data: folder } = await supabase
      .from('folders')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })

    const { data: projects, error } = await supabase
      .from('projects')
      .select('id, name, url, thumbnail_url, status, created_at, updated_at')
      .eq('folder_id', id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ projects: projects || [] })
  } catch (err) {
    console.error('Folder projects GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
