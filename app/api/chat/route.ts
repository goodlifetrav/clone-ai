import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { chatWithProjectStreaming } from '@/lib/anthropic'
import { isAdminEmail } from '@/lib/admin'

const FREE_CHAT_LIMIT = 5

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
      .select('plan, is_admin, email')
      .eq('clerk_id', userId)
      .single()

    const { count } = await supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('role', 'user')

    const isLimited =
      user?.plan === 'free' && !user?.is_admin && !isAdminEmail(user?.email)

    return NextResponse.json({
      messagesUsed: count ?? 0,
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
  const { projectId, message, currentHtml, imageBase64, imageMimeType } = body

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

  if (user.plan === 'free' && !adminOverride) {
    const { count: messageCount } = await supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('role', 'user')

    if ((messageCount ?? 0) >= FREE_CHAT_LIMIT) {
      return NextResponse.json(
        {
          error: "You've reached your free chat limit.",
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
        let finalHtml = currentHtml
        let finalMessage = ''
        let tokensUsed = 0

        ;({ html: finalHtml, message: finalMessage, tokensUsed } =
          await chatWithProjectStreaming(
            currentHtml,
            chatMessages,
            (partialHtml) => send({ htmlChunk: partialHtml }),
            imageBase64,
            imageMimeType
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

        await supabase
          .from('users')
          .update({ tokens_used: user.tokens_used + tokensUsed })
          .eq('id', user.id)

        const { count: newCount } = await supabase
          .from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', projectId)
          .eq('role', 'user')

        send({ done: true, html: finalHtml, message: finalMessage, messagesUsed: newCount ?? 0 })
      } catch (err) {
        const error = err as Error
        console.error('Chat stream error:', error)
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
