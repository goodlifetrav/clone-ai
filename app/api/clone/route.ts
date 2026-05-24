import { NextRequest, NextResponse } from 'next/server'
import { getAuth, getSession } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { extractDomain } from '@/lib/utils'
import { isAdminEmail } from '@/lib/admin'
import { reportError } from '@/lib/error-report'
import { checkUrlBlocked } from '@/lib/url-blocker'

export async function POST(request: NextRequest) {
  let cloneUrl: string | undefined
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { url } = await request.json()
    cloneUrl = url
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 })

    const block = checkUrlBlocked(url)
    if (block.blocked) {
      return NextResponse.json({ error: block.reason }, { status: 403 })
    }

    const supabase = createServiceClient()

    let { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('clerk_id', userId)
      .single()

    if (userError || !user) {
      const session = await getSession()
      const email = session.email ?? ''
      const name = session.name ?? ''

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
    const isAdmin = user.is_admin || adminByEmail

    if (!isAdmin) {
      const PLAN_MONTHLY_LIMITS: Record<string, number> = {
        free: 1,
        pro: 20,
        agency: 60,
      }

      const limit = PLAN_MONTHLY_LIMITS[user.plan] ?? 2

      if (user.plan === 'free') {
        // Count actual projects in DB — never trust a stored counter for free limit
        const { count: actualCount, error: countError } = await supabase
          .from('projects')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)

        console.log(`[clone-limit] user.id=${user.id} email=${user.email} plan=${user.plan} count=${actualCount} error=${countError?.message ?? 'none'} limit=${limit}`)

        // Fail closed: if count query errors, deny rather than allow
        if (countError || actualCount === null || actualCount >= limit) {
          return NextResponse.json(
            { error: 'Free tier limit reached. Upgrade to clone more websites.', upgradeRequired: true },
            { status: 403 }
          )
        }
      } else {
        // Paid plans: count since billing_period_start (resets on payment), fallback to start of month
        const billingStart = user.billing_period_start
          ? new Date(user.billing_period_start)
          : (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d })()

        const { count } = await supabase
          .from('projects')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .gte('created_at', billingStart.toISOString())

        if ((count ?? 0) >= limit) {
          return NextResponse.json(
            { error: `Monthly clone limit reached (${limit}/month on ${user.plan} plan). Resets on your next billing date.`, upgradeRequired: true },
            { status: 403 }
          )
        }
      }
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

    // Increment clones_count immediately so it's always accurate regardless
    // of which pipeline (DOM vs screenshot) completes the project.
    await supabase
      .from('users')
      .update({
        clones_count: (user.clones_count || 0) + 1,
        ...(user.plan === 'free' ? { free_clones_used: (user.free_clones_used || 0) + 1 } : {}),
      })
      .eq('id', user.id)

    // Fire-and-forget DOM extraction pipeline.
    // The client receives projectId immediately and navigates to the editor,
    // which streams from /api/projects/[id]/generate.
    // If the DOM pipeline completes first it sets status='complete' and the
    // generate route returns the cached HTML instantly.
    // If it fails the project stays 'pending' and the generate route falls back
    // to the existing screenshot/Claude Vision approach.
    runDomPipeline(project.id, url, user.id).catch((err) =>
      console.error('[DOM] Unhandled pipeline error:', err)
    )

    return NextResponse.json({ projectId: project.id })
  } catch (err) {
    const error = err as Error
    console.error('Clone error:', error)
    reportError(err, 'POST /api/clone', { url: cloneUrl })
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM extraction pipeline (runs asynchronously after the response is sent)
// ─────────────────────────────────────────────────────────────────────────────

async function runDomPipeline(projectId: string, url: string, userId: string): Promise<void> {
  const supabase = createServiceClient()

  try {
    const [
      { extractSite },
      { inlineCss },
      { makeUrlsAbsolute, rehostImages, rehostFonts },
      { cleanHtml },
    ] = await Promise.all([
      import('@/lib/extractor'),
      import('@/lib/css-inliner'),
      import('@/lib/asset-rehost'),
      import('@/lib/html-cleaner'),
    ])

    console.log(`[DOM] Starting pipeline for project ${projectId} — ${url}`)

    // 1. Extract rendered HTML via headless Chromium.
    //    Passing projectId enables real-time request interception — every image and
    //    font the browser loads is uploaded to R2 and a urlMap is returned.
    const { html: rawHtml, urlMap, screenshotBase64, contentDensity } = await extractSite(url, projectId)
    let html = rawHtml
    console.log(`[DOM] Extracted ${html.length} chars, intercepted ${urlMap.size} resources`)

    // 2. Inline external CSS (replaces <link rel="stylesheet"> with <style>)
    html = await inlineCss(html, url)
    console.log(`[DOM] CSS inlined — ${html.length} chars`)

    // 3a. Pre-decode &quot; inside CSS url() in style attributes.
    //     Chromium serialises url("https://...") in style= attrs as url(&quot;...&quot;).
    //     makeUrlsAbsolute() doesn't handle HTML entities inside url() and would
    //     corrupt the URL by resolving &quot;https://... as a path relative to the site.
    html = html.replace(/url\(&quot;([^&]+)&quot;\)/gi, 'url($1)')
    html = html.replace(/url\(&apos;([^&]+)&apos;\)/gi, 'url($1)')

    // 3b. Rewrite relative asset URLs to absolute
    html = makeUrlsAbsolute(html, url)
    console.log(`[DOM] URLs absolutified — ${html.length} chars`)

    // 4a. Apply URL map from real-time request interception (highest quality —
    //     covers resources loaded by JavaScript, carousels, dynamic backgrounds).
    if (urlMap.size > 0) {
      const sorted = [...urlMap.entries()].sort((a, b) => b[0].length - a[0].length)
      for (const [orig, r2] of sorted) {
        html = html.split(orig).join(r2)
        const encoded = orig.replace(/&/g, '&amp;')
        if (encoded !== orig) html = html.split(encoded).join(r2)
      }
      console.log(`[DOM] Applied ${urlMap.size} interception URL rewrites`)
    }

    // 4b. Re-host remaining images to R2 (fallback for any URLs missed by interception,
    //     e.g. images injected into inline style attributes by JavaScript after load).
    console.log('[DOM] Rehosting residual images...')
    html = await rehostImages(html, projectId)
    console.log('[DOM] Images rehosted')

    // 4b2. Re-host font files to R2 (fallback for web fonts not captured by Playwright
    //      interception — e.g. @font-face fonts inlined from CSS after the browser session).
    //      rehostImages() explicitly skips font extensions, so this is required separately.
    console.log('[DOM] Rehosting fonts...')
    html = await rehostFonts(html, projectId)
    console.log('[DOM] Fonts rehosted')

    // 4c. Resolve var(--clone-bg) → direct url() in style attributes.
    //     The extractor stores background-image URLs in a --clone-bg custom property
    //     to avoid Chrome's &quot; quote-encoding bug. After urlMap replacement the
    //     custom property holds the final R2 URL. We now resolve it directly so the
    //     saved HTML uses a plain background-image: url(R2URL) without any var() —
    //     guaranteeing the browser renders it without CSS custom property resolution.
    html = resolveCloneBg(html)
    console.log('[DOM] var(--clone-bg) resolved')

    // 5. Strip scripts/tracking, add <base target="_blank">, inject AJAX placeholders
    html = cleanHtml(html, url)
    console.log(`[DOM] HTML cleaned — ${html.length} chars`)

    // ── Pillar 2: SPA reconstruction via Gemini Vision ───────────────────────
    // Triggers when content is sparse (blank/incomplete DOM) OR when the page is
    // a JavaScript SPA (Next.js, React, Nuxt, Vue, Angular) whose layout depends
    // on client-side hydration that a static clone can't run.
    // Uses Gemini 2.5 Flash Vision (~$0.01/clone) instead of Claude (~$0.50/clone).
    const isSparse = contentDensity.imgs < 4 && contentDensity.textLen < 800
    const isSpa = /<script[^>]*id="__NEXT_DATA__"/i.test(html) ||
      /window\.__NEXT_DATA__/i.test(html) ||
      /<div[^>]*id="__nuxt__"/i.test(html) ||
      /window\.__NUXT__/i.test(html) ||
      /ng-version=/i.test(html) ||
      (/<div[^>]*id="root"\s*><\/div>/i.test(html)) // empty React root

    if ((isSparse || isSpa) && screenshotBase64) {
      console.log(`[DOM] Pillar 2: ${isSparse ? 'sparse' : 'SPA'} detected (imgs=${contentDensity.imgs} textLen=${contentDensity.textLen} spa=${isSpa}) — Gemini Vision reconstruction`)
      try {
        const { generateCloneWithGemini } = await import('@/lib/gemini')
        const result = await generateCloneWithGemini(html, screenshotBase64, url)
        html = result.html
        console.log(`[DOM] Pillar 2: Gemini Vision reconstruction complete — ${html.length} chars, ${result.tokensUsed} tokens`)
      } catch (err) {
        console.log('[DOM] Pillar 2: Gemini Vision failed (using DOM result):', err)
      }
    }

    // ── Pillar 3: Final image completeness pass ───────────────────────────────
    // After all processing, scan for any <img src> or url() still pointing to the
    // original domain (not yet uploaded to R2). This catches images injected by
    // cleanHtml, header/footer sync, or Pillar 2's reconstruction that reference
    // URLs missed by the earlier rehostImages call.
    try {
      const origHost = new URL(url).hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const residualRe = new RegExp(`["'(]https?://(?:[^"'()]*\\.)?${origHost}/[^"'()]*\\.(?:jpe?g|png|webp|gif|avif|svg)(?:\\?[^"'()]*)?(?=["'()]|\\))`, 'i')
      if (residualRe.test(html)) {
        console.log('[DOM] Pillar 3: residual original-domain images detected — final rehostImages pass')
        html = await rehostImages(html, projectId)
        console.log('[DOM] Pillar 3: residual rehost complete')
      }
    } catch { /* non-fatal */ }

    // 6. Sync header/footer from the most recently completed clone of the same domain,
    //    scoped to this user's folder (falls back to same user + same domain if no folder).
    const domain = extractDomain(url)
    if (domain) {
      // Get the current project's folder_id (may be set by the time the pipeline runs)
      const { data: currentProject } = await supabase
        .from('projects')
        .select('folder_id')
        .eq('id', projectId)
        .single()

      const folderId = currentProject?.folder_id ?? null

      let siblingQuery = supabase
        .from('projects')
        .select('html_content')
        .neq('id', projectId)
        .eq('user_id', userId)
        .ilike('url', `%://${domain}/%`)
        .eq('status', 'complete')
        .order('created_at', { ascending: false })
        .limit(1)

      if (folderId) {
        siblingQuery = siblingQuery.eq('folder_id', folderId)
      }

      const { data: sibling } = await siblingQuery.single()

      if (sibling?.html_content) {
        const { extractHeaderFooter, applyHeaderFooter } = await import('@/lib/header-footer-sync')
        const hf = extractHeaderFooter(sibling.html_content)
        if (hf.header || hf.footer) {
          html = applyHeaderFooter(html, hf)
          console.log(`[DOM] Header/footer synced — folder:${folderId ?? 'none'} header:${!!hf.header} footer:${!!hf.footer}`)
        }
      }
    }

    // 7. Save to database
    console.log(`[DOM] Saving ${html.length} chars to DB...`)
    const { error: saveError } = await supabase
      .from('projects')
      .update({ html_content: html, status: 'complete', clone_method: 'dom' })
      .eq('id', projectId)

    if (saveError) {
      console.error(`[DOM] Supabase save FAILED for project ${projectId}:`, JSON.stringify(saveError))
      throw new Error(`Supabase save failed: ${saveError.message}`)
    }

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

// ─────────────────────────────────────────────────────────────────────────────
// resolveCloneBg — collapse var(--clone-bg) → direct url() in style= attributes.
//
// The extractor uses a CSS custom property (--clone-bg) to dodge Chrome's CSSOM
// quote-normalisation bug that turns url("X") into url(&quot;X&quot;) in outerHTML.
// After all URL replacements the custom property holds the final CDN URL.
// Resolving it here means the saved HTML always contains a plain
//   background-image: url(https://cdn...)
// so the browser never needs to evaluate var() — working in every context.
// ─────────────────────────────────────────────────────────────────────────────
function resolveCloneBg(html: string): string {
  // Match a double-quoted style attribute that contains var(--clone-bg)
  return html.replace(
    /(<[a-zA-Z][^>]*\sstyle=")([^"]*var\(--clone-bg\)[^"]*)"/g,
    (_match, tagPrefix, styleContent) => {
      // Extract the URL stored in --clone-bg: url(...)
      const bgMatch = styleContent.match(/--clone-bg:\s*url\(([^)]+)\)/)
      if (!bgMatch) return _match
      const bgUrl = bgMatch[1].trim()
      // Replace every var(--clone-bg) reference with the actual url()
      let resolved = styleContent.replace(/\bvar\(--clone-bg\)/g, `url(${bgUrl})`)
      // Strip the now-redundant --clone-bg custom property declaration
      resolved = resolved
        .replace(/;?\s*--clone-bg:[^;]+(;|$)/g, ';')
        .replace(/;{2,}/g, ';')
        .replace(/;\s*$/, '')
      return `${tagPrefix}${resolved}"`
    }
  )
}
