import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, token, repoName, isPrivate = false } = await request.json()
    if (!projectId || !token || !repoName) {
      return NextResponse.json(
        { error: 'projectId, token, and repoName are required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('clerk_id', userId)
      .single()

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { data: project } = await supabase
      .from('projects')
      .select('name, html_content, url')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const ghHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    }

    // Get authenticated GitHub user (to resolve owner)
    const meRes = await fetch('https://api.github.com/user', { headers: ghHeaders })
    if (!meRes.ok) {
      const err = await meRes.json()
      return NextResponse.json(
        { error: err.message || 'Invalid GitHub token' },
        { status: 400 }
      )
    }
    const me = await meRes.json()
    const owner = me.login as string

    const safeName = repoName.trim().replace(/[^a-zA-Z0-9._-]/g, '-')

    // Create repo (ignore error if it already exists — we'll just push to it)
    await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({
        name: safeName,
        description: `Cloned from ${project.url} via IgualAI`,
        private: isPrivate,
        auto_init: false,
      }),
    })

    // Check if index.html already exists (needed for SHA when updating)
    const existingRes = await fetch(
      `https://api.github.com/repos/${owner}/${safeName}/contents/index.html`,
      { headers: ghHeaders }
    )
    const existing = existingRes.ok ? await existingRes.json() : null

    const content = Buffer.from(project.html_content, 'utf8').toString('base64')

    const fileBody: Record<string, unknown> = {
      message: `Update clone via IgualAI`,
      content,
    }
    if (existing?.sha) fileBody.sha = existing.sha

    const pushRes = await fetch(
      `https://api.github.com/repos/${owner}/${safeName}/contents/index.html`,
      {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify(fileBody),
      }
    )

    if (!pushRes.ok) {
      const err = await pushRes.json()
      return NextResponse.json(
        { error: err.message || 'Failed to push to GitHub' },
        { status: 502 }
      )
    }

    const repoUrl = `https://github.com/${owner}/${safeName}`
    const pagesUrl = `https://${owner}.github.io/${safeName}`

    return NextResponse.json({ repoUrl, pagesUrl, owner, repo: safeName })
  } catch (err) {
    console.error('GitHub push error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
