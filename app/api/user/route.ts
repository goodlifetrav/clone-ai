import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET() {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()
    const { data: user } = await supabase
      .from('users')
      .select('plan, is_admin, tokens_used, clones_count, free_chats_used')
      .eq('clerk_id', userId)
      .single()

    return NextResponse.json({
      plan: user?.plan ?? 'free',
      is_admin: user?.is_admin ?? false,
      tokens_used: user?.tokens_used ?? 0,
      clones_count: user?.clones_count ?? 0,
      free_chats_used: user?.free_chats_used ?? 0,
    })
  } catch (err) {
    console.error('User GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
