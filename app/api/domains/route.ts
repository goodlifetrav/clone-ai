import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i
const SERVER_IP = '187.124.219.202'

export async function GET() {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabase = createServiceClient()

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_id', userId)
      .single()

    if (!user) return NextResponse.json({ domains: [] })

    const { data: domains, error } = await supabase
      .from('custom_domains')
      .select('*, projects(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const shaped = (domains ?? []).map((d) => ({
      ...d,
      project_name: (d.projects as { name: string } | null)?.name ?? null,
      projects: undefined,
    }))

    return NextResponse.json({ domains: shaped })
  } catch (err) {
    console.error('Domains GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { domain, project_id } = await request.json() as { domain: string; project_id: string }

    if (!domain || !project_id) {
      return NextResponse.json({ error: 'domain and project_id are required' }, { status: 400 })
    }

    const normalised = domain.trim().toLowerCase()

    if (!DOMAIN_REGEX.test(normalised)) {
      return NextResponse.json({ error: 'Invalid domain format' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_id', userId)
      .single()

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Check for duplicates
    const { data: existing } = await supabase
      .from('custom_domains')
      .select('id')
      .eq('domain', normalised)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Domain already registered' }, { status: 409 })
    }

    const { data: record, error } = await supabase
      .from('custom_domains')
      .insert({
        user_id: user.id,
        project_id,
        domain: normalised,
        verified: false,
        ssl_provisioned: false,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      domain: record,
      dns_instructions: {
        type: 'A',
        name: '@',
        value: SERVER_IP,
        ttl: 3600,
        message: `Add an A record pointing ${normalised} → ${SERVER_IP}`,
      },
    })
  } catch (err) {
    console.error('Domains POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
