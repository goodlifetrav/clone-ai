import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId } = await request.json()
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

    const supabase = createServiceClient()

    // Get user and project
    const { data: user } = await supabase
      .from('users')
      .select('id, plan')
      .eq('clerk_id', userId)
      .single()

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    if (user.plan === 'free' || user.plan === 'starter') {
      return NextResponse.json(
        { error: 'Upgrade to Pro or above to deploy to Vercel', upgradeRequired: true },
        { status: 403 }
      )
    }

    const { data: project } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    // Deploy to Vercel via their API
    const vercelToken = process.env.VERCEL_TOKEN
    if (!vercelToken) {
      return NextResponse.json(
        { error: 'Vercel integration not configured. Add VERCEL_TOKEN to .env.local' },
        { status: 503 }
      )
    }

    const deploymentName = project.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')

    const deployResponse = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: deploymentName,
        files: [
          {
            file: 'index.html',
            data: project.html_content,
            encoding: 'utf8',
          },
        ],
        projectSettings: {
          framework: null,
        },
        target: 'production',
      }),
    })

    if (!deployResponse.ok) {
      const error = await deployResponse.json()
      return NextResponse.json(
        { error: error.error?.message || 'Vercel deployment failed' },
        { status: 502 }
      )
    }

    const deployment = await deployResponse.json()

    return NextResponse.json({
      deployUrl: `https://${deployment.url}`,
      deploymentId: deployment.id,
    })
  } catch (err) {
    console.error('Deploy error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
