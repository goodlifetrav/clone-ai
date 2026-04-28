import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
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

export async function GET() {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { supabase, user } = await getDbUser(userId)
    if (!user) return NextResponse.json({ folders: [] })

    const { data: folders, error } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ folders: folders ?? [] })
  } catch (err) {
    console.error('Folders GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { name } = await request.json()
    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const { supabase, user } = await getDbUser(userId)
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { data: folder, error } = await supabase
      .from('folders')
      .insert({ user_id: user.id, name: name.trim() })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ folder })
  } catch (err) {
    console.error('Folders POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
