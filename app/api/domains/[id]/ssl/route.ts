import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'

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
      return NextResponse.json(
        { error: 'Domain must be verified before provisioning SSL' },
        { status: 400 }
      )
    }

    if (record.ssl_provisioned) {
      return NextResponse.json({ ssl_provisioned: true, queued: false })
    }

    // SSL is provisioned by a host-side cron job (/usr/local/bin/provision-ssl.sh)
    // that runs every minute and handles certbot + nginx config for all verified domains.
    // This endpoint just validates the request and signals readiness.
    return NextResponse.json({
      queued: true,
      message: 'SSL provisioning started — your certificate will be ready within 1–2 minutes.',
    })
  } catch (err) {
    console.error('SSL provision error:', err)
    return NextResponse.json({ error: 'SSL provisioning failed' }, { status: 500 })
  }
}
