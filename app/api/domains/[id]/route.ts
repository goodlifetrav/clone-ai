import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import dns from 'dns'

const SERVER_IP = '187.124.219.202'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_id', userId)
      .single()

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { data: record } = await supabase
      .from('custom_domains')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!record) return NextResponse.json({ error: 'Domain not found' }, { status: 404 })

    try {
      const addresses = await dns.promises.resolve4(record.domain)
      if (addresses.includes(SERVER_IP)) {
        await supabase
          .from('custom_domains')
          .update({ verified: true })
          .eq('id', id)

        return NextResponse.json({ verified: true })
      }
    } catch {
      // DNS resolution failed — domain not pointing anywhere yet
    }

    return NextResponse.json({ verified: false })
  } catch (err) {
    console.error('Domain GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_id', userId)
      .single()

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { error } = await supabase
      .from('custom_domains')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error('Domain DELETE error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
