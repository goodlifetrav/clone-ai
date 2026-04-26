import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { chatWithProject } from '@/lib/anthropic'

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

    // Verify project belongs to user
    const { data: user } = await supabase
      .from('users')
      .select('id, plan, tokens_used')
      .eq('clerk_id', userId)
      .single()

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Check token limits
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

    return NextResponse.json({ html, message: aiMessage, tokensUsed })
  } catch (err) {
    console.error('Chat API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
