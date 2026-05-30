import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { chatWithProjectGemini } from '@/lib/gemini'
import { isAdminEmail } from '@/lib/admin'
import { reportError } from '@/lib/error-report'
import { createJob, completeJob, failJob } from '@/lib/chat-jobs'
import { extractHeaderFooter, replaceHeaderFooter, mergeFontLinks } from '@/lib/header-footer'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

    const supabase = createServiceClient()

    const { data: user } = await supabase
      .from('users')
      .select('plan, is_admin, email, tokens_used')
      .eq('clerk_id', userId)
      .single()

    const TOKEN_LIMITS: Record<string, number> = {
      free: 75000, starter: 500000, pro: 2000000, growth: 5000000, max: 10000000, agency: 6000000,
    }
    const tokenLimit = TOKEN_LIMITS[user?.plan ?? 'free'] ?? 75000
    const tokensUsed = user?.tokens_used ?? 0
    const isLimited = !user?.is_admin && !isAdminEmail(user?.email ?? '') && tokensUsed >= tokenLimit

    return NextResponse.json({ isLimited, tokensUsed, tokenLimit })
  } catch (err) {
    console.error('Chat GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  // ── Auth & input validation ──────────────────────────────────────────────
  const { userId } = await getAuth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { projectId, message, uploadedImageUrls } = body

  if (!projectId || !message) {
    return NextResponse.json({ error: 'projectId and message are required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, plan, is_admin, tokens_used, email')
    .eq('clerk_id', userId)
    .single()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const adminOverride = user.is_admin || isAdminEmail(user.email)

  // ── Usage limit check ────────────────────────────────────────────────────
  if (!adminOverride) {
    const TOKEN_LIMITS: Record<string, number> = {
      free: 75000, starter: 500000, pro: 2000000, growth: 5000000, max: 10000000, agency: 6000000,
    }
    const limit = TOKEN_LIMITS[user.plan] || 10000
    if (user.tokens_used >= limit) {
      return NextResponse.json(
        { error: 'Token limit reached. Upgrade your plan for more.', upgradeRequired: true },
        { status: 403 }
      )
    }
  }

  // ── Fetch current state ──────────────────────────────────────────────────
  const [{ data: project }, { data: chatHistory }] = await Promise.all([
    supabase
      .from('projects')
      .select('html_content, folder_id, url')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('chat_messages')
      .select('role, content')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(20),
  ])

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Only use stored HTML as blueprint if it's a real HTML document — not garbage from a failed generation
  const raw = project?.html_content ?? ''
  const currentHtml = raw.length > 500 && /<html/i.test(raw) ? raw : ''
  const chatMessages = [
    ...(chatHistory || []).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: message },
  ]

  // ── Create job and start background generation ───────────────────────────
  const jobId = crypto.randomUUID()
  createJob(jobId, projectId)

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  runChatJob(jobId, projectId, currentHtml, chatMessages, uploadedImageUrls, user, adminOverride, message, project?.folder_id ?? null, project?.url ?? null)

  return NextResponse.json({ jobId })
}

// ── Background job ───────────────────────────────────────────────────────────
async function runChatJob(
  jobId: string,
  projectId: string,
  currentHtml: string,
  chatMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  uploadedImageUrls: string[] | undefined,
  user: { id: string; plan: string; tokens_used: number },
  adminOverride: boolean,
  originalMessage: string,
  folderId: string | null,
  projectUrl: string | null
) {
  const supabase = createServiceClient()

  try {
    const { html: finalHtml, message: finalMessage, tokensUsed, estimatedCost } =
      await chatWithProjectGemini(currentHtml, chatMessages, uploadedImageUrls)

    const isValidHtml =
      finalHtml.length > 2000 &&
      /<html/i.test(finalHtml) &&
      /<body/i.test(finalHtml) &&
      /<\/html>/i.test(finalHtml)

    // Persist chat messages
    await supabase.from('chat_messages').insert([
      { project_id: projectId, user_id: user.id, role: 'user', content: originalMessage },
      { project_id: projectId, user_id: user.id, role: 'assistant', content: finalMessage },
    ])

    // Only save HTML to DB if it's a complete valid document
    if (isValidHtml) {
      await supabase
        .from('projects')
        .update({ html_content: finalHtml, updated_at: new Date().toISOString() })
        .eq('id', projectId)

      // Auto-sync header/footer to all sibling pages.
      // Fire-and-forget — does not block the response to the user.
      if (folderId) {
        syncHeaderFooterToFolder(projectId, folderId, finalHtml, supabase).catch((e) =>
          console.error('[header-sync] failed:', e)
        )
      } else if (projectUrl) {
        syncHeaderFooterByDomain(projectId, user.id, projectUrl, finalHtml, supabase).catch((e) =>
          console.error('[header-sync] domain-sync failed:', e)
        )
      }
    }

    // Update token usage
    await supabase.from('users').update({ tokens_used: user.tokens_used + tokensUsed }).eq('id', user.id)

    console.log(`[chat] job complete — tokens: ${tokensUsed}, cost: $${(estimatedCost ?? 0).toFixed(4)}, project: ${projectId}`)
    completeJob(
      jobId,
      isValidHtml ? finalHtml : currentHtml,
      isValidHtml ? finalMessage : 'Could not generate a complete page. Please try again.',
      tokensUsed,
      estimatedCost
    )
  } catch (err) {
    const error = err as Error
    console.error('[chat job error]', error)
    reportError(err, 'POST /api/chat background job', { projectId })
    // Never expose raw API error messages (e.g. GoogleGenerativeAI stack traces) to users
    const isApiError = /GoogleGenerativeAI|fetchai|generativelanguage|googleapis/i.test(error.message)
    const userMessage = isApiError
      ? 'AI service is temporarily unavailable. Please try again in a moment.'
      : error.message || 'Generation failed. Please try again.'
    failJob(jobId, userMessage)
  }
}

/**
 * After any AI edit on a page in a folder, extract the new header/footer and
 * push it to every other rebuilt page in the same folder. This ensures logo
 * position, nav links, colors, and footer stay in sync across all pages
 * without the user having to manually re-rebuild each page.
 *
 * Only patches pages that have already been rebuilt (contain data-igualai-section).
 * Raw clones are left untouched — they don't have section boundaries.
 * Runs fire-and-forget so it never delays the user's chat response.
 */
async function syncHeaderFooterToFolder(
  editedProjectId: string,
  folderId: string,
  editedHtml: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  // Only sync if the edited page has been rebuilt (has section attributes)
  if (!editedHtml.includes('data-igualai-section')) return

  const { headerHtml, footerHtml } = extractHeaderFooter(editedHtml)
  if (!headerHtml && !footerHtml) return

  // Save updated header/footer to folder brand_profile
  const { data: folder } = await supabase
    .from('folders')
    .select('brand_profile')
    .eq('id', folderId)
    .single()

  const existing = folder?.brand_profile ?? {}
  await supabase
    .from('folders')
    .update({ brand_profile: { ...existing, headerHtml, footerHtml } })
    .eq('id', folderId)

  // Fetch all OTHER pages in the folder
  const { data: siblings } = await supabase
    .from('projects')
    .select('id, html_content')
    .eq('folder_id', folderId)
    .neq('id', editedProjectId)

  if (!siblings || siblings.length === 0) return

  // Patch each sibling's header/footer — skip raw clones (no data-igualai-section)
  const updates = siblings
    .filter((s) => s.html_content && s.html_content.includes('data-igualai-section'))
    .map((s) => {
      const replaced = replaceHeaderFooter(s.html_content, headerHtml, footerHtml)
      // Also sync font <link> tags so the nav fonts render identically on all pages
      const html = mergeFontLinks(replaced, editedHtml)
      return { id: s.id, html }
    })
    .filter((u) => u.html !== siblings.find((s) => s.id === u.id)?.html_content)

  await Promise.all(
    updates.map((u) =>
      supabase
        .from('projects')
        .update({ html_content: u.html, updated_at: new Date().toISOString() })
        .eq('id', u.id)
    )
  )

  console.log(`[header-sync] synced header/footer from project ${editedProjectId} to ${updates.length} sibling(s) in folder ${folderId}`)
}

/**
 * Same as syncHeaderFooterToFolder but scoped to user_id + domain when pages
 * are not organized in a folder. Ensures chat edits to the homepage header/footer
 * propagate to all other pages from the same domain even without a folder.
 */
async function syncHeaderFooterByDomain(
  editedProjectId: string,
  userId: string,
  projectUrl: string,
  editedHtml: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  if (!editedHtml.includes('data-igualai-section')) return

  const { headerHtml, footerHtml } = extractHeaderFooter(editedHtml)
  if (!headerHtml && !footerHtml) return

  let domain = ''
  try { domain = new URL(projectUrl).hostname.replace(/^www\./, '') } catch { return }
  if (!domain) return

  const { data: siblings } = await supabase
    .from('projects')
    .select('id, html_content')
    .eq('user_id', userId)
    .neq('id', editedProjectId)
    .ilike('url', `%${domain}%`)
    .not('html_content', 'is', null)

  if (!siblings || siblings.length === 0) return

  const updates = siblings
    .filter((s) => s.html_content && s.html_content.includes('data-igualai-section'))
    .map((s) => {
      const replaced = replaceHeaderFooter(s.html_content, headerHtml, footerHtml)
      const html = mergeFontLinks(replaced, editedHtml)
      return { id: s.id, html }
    })
    .filter((u) => u.html !== siblings.find((s) => s.id === u.id)?.html_content)

  await Promise.all(
    updates.map((u) =>
      supabase
        .from('projects')
        .update({ html_content: u.html, updated_at: new Date().toISOString() })
        .eq('id', u.id)
    )
  )

  console.log(`[header-sync] domain-synced header/footer from project ${editedProjectId} to ${updates.length} sibling(s) for domain ${domain}`)
}
