import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { chatWithProject } from '@/lib/anthropic'
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
  try {
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId, message, currentHtml, imageBase64, imageMimeType } =
      await request.json()

    if (!projectId || !message) {
      return NextResponse.json({ error: 'projectId and message are required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data: user } = await supabase
      .from('users')
      .select('id, plan, is_admin, tokens_used, email')
      .eq('clerk_id', userId)
      .single()

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const adminOverride = user.is_admin || isAdminEmail(user.email)

    // Enforce free tier chat limit
    if (user.plan === 'free' && !adminOverride) {
      const { count: messageCount } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('role', 'user')

      if ((messageCount ?? 0) >= FREE_CHAT_LIMIT) {
        return NextResponse.json(
          {
            error: "You've reached your free chat limit. Upgrade to continue chatting with AI.",
            upgradeRequired: true,
            chatLimitReached: true,
          },
          { status: 403 }
        )
      }
    }

    // Check token limits (admins are exempt)
    if (!adminOverride) {
      const TOKEN_LIMITS: Record<string, number> = {
        free: 10000,
        starter: 40000,
        pro: 100000,
        growth: 200000,
        max: 400000,
      }
      const limit = TOKEN_LIMITS[user.plan] || 10000
      if (user.tokens_used >= limit) {
        return NextResponse.json(
          { error: 'Token limit reached. Upgrade your plan for more.', upgradeRequired: true },
          { status: 403 }
        )
      }
    }

    // Get chat history
    const { data: chatHistory } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(20)

    const messages = [
      ...(chatHistory || []).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content: message },
    ]

    // Call Claude
    const { html, message: aiMessage, tokensUsed } = await chatWithProject(
      currentHtml,
      messages,
      imageBase64,
      imageMimeType
    )

    // Save messages to DB
    await supabase.from('chat_messages').insert([
      {
        project_id: projectId,
        user_id: user.id,
        role: 'user',
        content: message,
      },
      {
        project_id: projectId,
        user_id: user.id,
        role: 'assistant',
        content: aiMessage,
      },
    ])

    // Update project HTML
    await supabase
      .from('projects')
      .update({ html_content: html, updated_at: new Date().toISOString() })
      .eq('id', projectId)

    // Update user token usage
    await supabase
      .from('users')
      .update({ tokens_used: user.tokens_used + tokensUsed })
      .eq('id', user.id)

    // Return updated count so the client can stay in sync
    const { count: newCount } = await supabase
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('role', 'user')

    return NextResponse.json({
      html,
      message: aiMessage,
      tokensUsed,
      messagesUsed: newCount ?? 0,
    })
  } catch (err) {
    console.error('Chat API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
