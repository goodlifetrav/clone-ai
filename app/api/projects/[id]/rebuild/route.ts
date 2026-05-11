import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { isAdminEmail } from '@/lib/admin'
import { chatWithProjectGemini } from '@/lib/gemini'
import { injectBrandImages } from '@/lib/image-injection'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { userId } = await getAuth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, plan, is_admin, email')
    .eq('clerk_id', userId)
    .single()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { data: project } = await supabase
    .from('projects')
    .select('html_content, user_id')
    .eq('id', id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const body = await request.json()
  const { brandName, tagline, primaryColor, secondaryColor, accentColor, logoUrl, brandDescription, headline, subheadline, ctaText } = body

  // Build a compact brand description to pass as the user message
  const brandMessage = [
    `Brand Name: ${brandName}`,
    tagline ? `Tagline: ${tagline}` : null,
    brandDescription ? `Description: ${brandDescription}` : null,
    `Primary Color: ${primaryColor}`,
    secondaryColor ? `Secondary Color: ${secondaryColor}` : null,
    accentColor ? `Accent Color: ${accentColor}` : null,
    logoUrl ? `Logo URL: ${logoUrl}` : null,
    headline ? `Hero Headline: ${headline}` : null,
    subheadline ? `Hero Subheadline: ${subheadline}` : null,
    ctaText ? `CTA Button Text: ${ctaText}` : null,
  ].filter(Boolean).join('\n')

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { /* client disconnected */ }
      }

      const keepalive = setInterval(() => send({ status: 'thinking' }), 3000)

      try {
        send({ status: 'thinking' })

        // Use the same chatWithProjectGemini pipeline that powers chat edits.
        // Passing an empty history triggers the full brand rebuild path.
        const { html: rebuiltHtml } = await chatWithProjectGemini(
          project.html_content ?? '',
          [{ role: 'user', content: brandMessage }]
        )

        let fullHtml = rebuiltHtml

        // Stream the completed HTML to the client
        send({ htmlChunk: fullHtml })

        // ── Image generation ─────────────────────────────────────────────────
        send({ status: 'generating_images' })
        fullHtml = await injectBrandImages(
          fullHtml,
          { brandName, brandDescription, primaryColor, secondaryColor, tagline },
          id,
          (current, total) => send({ status: 'generating_images', current, total })
        )

        // Save to DB
        await supabase
          .from('projects')
          .update({ html_content: fullHtml, updated_at: new Date().toISOString() })
          .eq('id', id)

        send({ done: true, html: fullHtml })
      } catch (err) {
        const error = err as Error
        console.error('Rebuild error:', error)
        send({ error: error.message || 'Rebuild failed' })
      } finally {
        clearInterval(keepalive)
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
