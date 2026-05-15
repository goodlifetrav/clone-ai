import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'

async function getDbUser(userId: string) {
  const supabase = createServiceClient()
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_id', userId)
    .single()
  return { supabase, user }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const { supabase, user } = await getDbUser(userId)
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { data: folder, error } = await supabase
      .from('folders')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })

    return NextResponse.json({ folder })
  } catch (err) {
    console.error('Folder GET error:', err)
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

    const updates: Record<string, unknown> = {}
    if (body.name !== undefined) {
      if (!body.name?.trim()) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
      updates.name = body.name.trim()
    }
    if (body.brand_profile !== undefined) {
      updates.brand_profile = body.brand_profile
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const { supabase, user } = await getDbUser(userId)
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { data: folder, error } = await supabase
      .from('folders')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })

    return NextResponse.json({ folder })
  } catch (err) {
    console.error('Folder PUT error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const { supabase, user } = await getDbUser(userId)
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Move all projects out of this folder before deleting
    await supabase
      .from('projects')
      .update({ folder_id: null })
      .eq('folder_id', id)
      .eq('user_id', user.id)

    const { error } = await supabase
      .from('folders')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Folder DELETE error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
