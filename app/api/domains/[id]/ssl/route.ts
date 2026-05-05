import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { userId } = await auth()
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

    if (!record.verified) {
      return NextResponse.json({ error: 'Domain must be verified before provisioning SSL' }, { status: 400 })
    }

    const domain = record.domain
    const cmd = `certbot certonly --nginx -d ${domain} --non-interactive --agree-tos -m admin@igualai.com`

    await execAsync(cmd)

    await supabase
      .from('custom_domains')
      .update({ ssl_provisioned: true })
      .eq('id', id)

    return NextResponse.json({ ssl_provisioned: true })
  } catch (err) {
    console.error('SSL provision error:', err)
    return NextResponse.json({ error: 'SSL provisioning failed' }, { status: 500 })
  }
}
