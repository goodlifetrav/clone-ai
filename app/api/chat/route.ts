import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { chatWithProjectGemini } from '@/lib/gemini'
import { isAdminEmail } from '@/lib/admin'
import { reportError } from '@/lib/error-report'
import { createJob, completeJob, failJob } from '@/lib/chat-jobs'

const FREE_CHAT_LIMIT = 2

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
      .select('plan, is_admin, email, free_chats_used')
      .eq('clerk_id', userId)
      .single()

    const isLimited =
      user?.plan === 'free' && !user?.is_admin && !isAdminEmail(user?.email)

    return NextResponse.json({
      messagesUsed: isLimited ? (user?.free_chats_used ?? 0) : 0,
      isLimited,
      limit: isLimited ? FREE_CHAT_LIMIT : null,
    })
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
    .select('id, plan, is_admin, tokens_used, email, free_chats_used')
    .eq('clerk_id', userId)
    .single()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const adminOverride = user.is_admin || isAdminEmail(user.email)

  // ── Usage limit checks ───────────────────────────────────────────────────
  if (user.plan === 'free' && !adminOverride) {
    if ((user.free_chats_used ?? 0) >= FREE_CHAT_LIMIT) {
      return NextResponse.json(
        {
          error: "You've used your 5 free edits. Upgrade to Pro for unlimited AI modifications.",
          upgradeRequired: true,
          chatLimitReached: true,
        },
        { status: 403 }
      )
    }
  }

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
    supabase.from('projects').select('html_content').eq('id', projectId).single(),
    supabase
      .from('chat_messages')
      .select('role, content')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(20),
  ])

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
  // Return the jobId immediately — no nginx timeout risk.
  // The generation continues in the background on the Node.js event loop.
  const jobId = crypto.randomUUID()
  createJob(jobId, projectId)

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  runChatJob(jobId, projectId, currentHtml, chatMessages, uploadedImageUrls, user, adminOverride, message)

  return NextResponse.json({ jobId })
}

// ── Background job ───────────────────────────────────────────────────────────
async function runChatJob(
  jobId: string,
  projectId: string,
  currentHtml: string,
  chatMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  uploadedImageUrls: string[] | undefined,
  user: { id: string; plan: string; tokens_used: number; free_chats_used: number | null },
  adminOverride: boolean,
  originalMessage: string
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
    }

    // Update token usage
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userUpdate: Record<string, any> = { tokens_used: user.tokens_used + tokensUsed }
    let newFreeChatsUsed = user.free_chats_used ?? 0
    if (user.plan === 'free' && !adminOverride) {
      newFreeChatsUsed += 1
      userUpdate.free_chats_used = newFreeChatsUsed
    }
    await supabase.from('users').update(userUpdate).eq('id', user.id)

    console.log(`[chat] job complete — tokens: ${tokensUsed}, cost: $${(estimatedCost ?? 0).toFixed(4)}, project: ${projectId}`)
    completeJob(
      jobId,
      isValidHtml ? finalHtml : currentHtml,
      isValidHtml ? finalMessage : 'Could not generate a complete page. Please try again.',
      newFreeChatsUsed,
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
