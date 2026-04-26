import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const clientId = process.env.GITHUB_CLIENT_ID
    if (!clientId) {
      return NextResponse.json({ error: 'GitHub OAuth not configured' }, { status: 503 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const redirectUri = `${appUrl}/api/github/callback`
    const state = userId // Use clerk userId as state for verification

    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo&state=${state}`

    return NextResponse.redirect(githubAuthUrl)
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  // Push a project to GitHub
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, repoName, accessToken } = await request.json()

    const { createGitHubRepo, pushFileToGitHub, getGitHubUser } = await import('@/lib/github')
    const { createServiceClient } = await import('@/lib/supabase')

    const supabase = createServiceClient()
    const { data: project } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const ghUser = await getGitHubUser(accessToken)
    const repo = await createGitHubRepo(accessToken, repoName || project.name)
    await pushFileToGitHub(accessToken, ghUser.login, repo.name, project.html_content)

    return NextResponse.json({ repoUrl: repo.html_url })
  } catch (err) {
    console.error('GitHub push error:', err)
    return NextResponse.json({ error: 'Failed to push to GitHub' }, { status: 500 })
  }
}
