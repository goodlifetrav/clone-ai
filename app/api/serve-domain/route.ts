import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const host = request.headers.get('host')?.split(':')[0] // strip port if present

    if (!host) {
      return new NextResponse('No host header', { status: 400 })
    }

    const supabase = createServiceClient()

    const { data: domainRecord } = await supabase
      .from('custom_domains')
      .select('project_id')
      .eq('domain', host)
      .eq('verified', true)
      .single()

    if (!domainRecord) {
      return new NextResponse('Domain not found or not verified', { status: 404 })
    }

    const { data: project } = await supabase
      .from('projects')
      .select('html_content')
      .eq('id', domainRecord.project_id)
      .single()

    if (!project?.html_content) {
      return new NextResponse('Project not found', { status: 404 })
    }

    return new NextResponse(project.html_content, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch (err) {
    console.error('serve-domain error:', err)
    return new NextResponse('Internal server error', { status: 500 })
  }
}
