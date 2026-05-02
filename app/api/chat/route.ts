import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { chatWithProjectStreaming } from '@/lib/anthropic'
import { isAdminEmail } from '@/lib/admin'
import { reportError } from '@/lib/error-report'

const FREE_CHAT_LIMIT = 2

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth()
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
  const encoder = new TextEncoder()

  // All pre-checks run before the stream opens so we can still return JSON
  // errors for limit-reached cases (the client handles those specially).
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { projectId, message, imageBase64, imageMimeType, uploadedImageUrls } = body

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
      free: 10000, starter: 40000, pro: 100000, growth: 200000, max: 400000,
    }
    const limit = TOKEN_LIMITS[user.plan] || 10000
    if (user.tokens_used >= limit) {
      return NextResponse.json(
        { error: 'Token limit reached. Upgrade your plan for more.', upgradeRequired: true },
        { status: 403 }
      )
    }
  }

  const { data: chatHistory } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(20)

  const chatMessages = [
    ...(chatHistory || []).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: message },
  ]

  // ── Streaming SSE response ───────────────────────────────────────────────
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { /* client disconnected */ }
      }

      try {
        const { data: project } = await supabase
          .from('projects')
          .select('html_content')
          .eq('id', projectId)
          .single()

        const currentHtml = project?.html_content ?? ''

        let finalHtml = currentHtml
        let finalMessage = ''
        let tokensUsed = 0

        ;({ html: finalHtml, message: finalMessage, tokensUsed } =
          await chatWithProjectStreaming(
            currentHtml,
            chatMessages,
            (partialHtml) => send({ htmlChunk: partialHtml }),
            imageBase64,
            imageMimeType,
            uploadedImageUrls
          ))

        // Persist to DB
        await supabase.from('chat_messages').insert([
          { project_id: projectId, user_id: user.id, role: 'user', content: message },
          { project_id: projectId, user_id: user.id, role: 'assistant', content: finalMessage },
        ])

        await supabase
          .from('projects')
          .update({ html_content: finalHtml, updated_at: new Date().toISOString() })
          .eq('id', projectId)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userUpdate: Record<string, any> = { tokens_used: user.tokens_used + tokensUsed }
        let newFreeChatsUsed = user.free_chats_used ?? 0
        if (user.plan === 'free' && !adminOverride) {
          newFreeChatsUsed += 1
          userUpdate.free_chats_used = newFreeChatsUsed
        }
        await supabase.from('users').update(userUpdate).eq('id', user.id)

        send({ done: true, html: finalHtml, message: finalMessage, messagesUsed: newFreeChatsUsed })
      } catch (err) {
        const error = err as Error
        console.error('Chat stream error:', error)
        reportError(err, 'POST /api/chat', { projectId })
        send({ error: error.message || 'Internal server error' })
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
