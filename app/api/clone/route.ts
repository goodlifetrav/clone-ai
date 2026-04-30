import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { extractDomain } from '@/lib/utils'
import { isAdminEmail } from '@/lib/admin'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { url } = await request.json()
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 })

    const supabase = createServiceClient()

    let { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('clerk_id', userId)
      .single()

    if (userError || !user) {
      const clerkUser = await currentUser()
      const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? ''
      const name = clerkUser
        ? `${clerkUser.firstName ?? ''} ${clerkUser.lastName ?? ''}`.trim()
        : ''

      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({ clerk_id: userId, email, name, plan: 'free', tokens_used: 0, clones_count: 0 })
        .select()
        .single()

      if (createError || !newUser) {
        return NextResponse.json({ error: 'Failed to create user record' }, { status: 500 })
      }
      user = newUser
    }

    const adminByEmail = isAdminEmail(user.email)
    if (!user.is_admin && !adminByEmail && user.plan === 'free' && user.clones_count >= 1) {
      return NextResponse.json(
        { error: 'Free tier limit reached. Upgrade to clone more websites.', upgradeRequired: true },
        { status: 403 }
      )
    }

    const { data: project, error: projectCreateError } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        name: extractDomain(url) || new URL(url).hostname,
        url,
        thumbnail_url: null,
        html_content: '',
        status: 'pending',
      })
      .select()
      .single()

    if (projectCreateError || !project) {
      console.error('Project create error:', projectCreateError)
      return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
    }

    // Fire-and-forget DOM extraction pipeline.
    // The client receives projectId immediately and navigates to the editor,
    // which streams from /api/projects/[id]/generate.
    // If the DOM pipeline completes first it sets status='complete' and the
    // generate route returns the cached HTML instantly.
    // If it fails the project stays 'pending' and the generate route falls back
    // to the existing screenshot/Claude Vision approach.
    runDomPipeline(project.id, url).catch((err) =>
      console.error('[DOM] Unhandled pipeline error:', err)
    )

    return NextResponse.json({ projectId: project.id })
  } catch (err) {
    const error = err as Error
    console.error('Clone error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM extraction pipeline (runs asynchronously after the response is sent)
// ─────────────────────────────────────────────────────────────────────────────

async function runDomPipeline(projectId: string, url: string): Promise<void> {
  const supabase = createServiceClient()

  try {
    const [
      { extractSite },
      { inlineCss },
      { rehostAssets },
      { cleanHtml },
    ] = await Promise.all([
      import('@/lib/extractor'),
      import('@/lib/css-inliner'),
      import('@/lib/asset-rehost'),
      import('@/lib/html-cleaner'),
    ])

    console.log(`[DOM] Starting pipeline for project ${projectId} — ${url}`)

    // 1. Extract rendered HTML via headless Chromium
    let html = await extractSite(url)
    console.log(`[DOM] Extracted ${html.length} chars`)

    // 2. Inline external CSS (replaces <link rel="stylesheet"> with <style>)
    html = await inlineCss(html, url)
    console.log(`[DOM] CSS inlined — ${html.length} chars`)

    // 3. Re-host images, fonts, and other assets to R2
    html = await rehostAssets(html, url, projectId)
    console.log(`[DOM] Assets rehosted — ${html.length} chars`)

    // 4. Strip scripts/tracking, add <base target="_blank">
    html = cleanHtml(html)
    console.log(`[DOM] HTML cleaned — ${html.length} chars`)

    // 5. Save to database
    await supabase
      .from('projects')
      .update({ html_content: html, status: 'complete', clone_method: 'dom' })
      .eq('id', projectId)

    console.log(`[DOM] Project ${projectId} complete via DOM extraction`)
  } catch (err) {
    console.error(`[DOM] Pipeline failed for project ${projectId}:`, err)
    // Leave status as 'pending' — generate route will use screenshot fallback
    await supabase
      .from('projects')
      .update({ clone_method: 'screenshot' })
      .eq('id', projectId)
      .then(
        () => {},
        (e: unknown) => console.error('[DOM] Failed to update clone_method:', e)
      )
  }
}
