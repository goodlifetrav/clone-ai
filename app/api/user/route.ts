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
      .select('plan, is_admin')
      .eq('clerk_id', userId)
      .single()

    return NextResponse.json({
      plan: user?.plan ?? 'free',
      is_admin: user?.is_admin ?? false,
    })
  } catch (err) {
    console.error('User GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
