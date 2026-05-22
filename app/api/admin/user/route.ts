import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isAdminEmail } from '@/lib/admin'
import { createServiceClient } from '@/lib/supabase'

async function checkAdmin() {
  const session = await getSession()
  if (!session.whopUserId) return false
  const supabase = createServiceClient()
  const { data: me } = await supabase.from('users').select('is_admin, email').eq('clerk_id', session.whopUserId).single()
  return me?.is_admin || isAdminEmail(me?.email)
}

export async function GET(request: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const email = request.nextUrl.searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const supabase = createServiceClient()
  const { data: user } = await supabase
    .from('users')
    .select('email, plan, clones_count, tokens_used, created_at, is_admin')
    .eq('email', email)
    .single()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  return NextResponse.json(user)
}

export async function PATCH(request: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, plan } = await request.json()
  if (!email || !plan) return NextResponse.json({ error: 'email and plan required' }, { status: 400 })
  if (!['free', 'pro', 'agency'].includes(plan)) return NextResponse.json({ error: 'invalid plan' }, { status: 400 })

  const supabase = createServiceClient()
  const { error } = await supabase.from('users').update({ plan }).eq('email', email)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
