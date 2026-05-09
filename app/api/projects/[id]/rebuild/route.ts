import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { isAdminEmail } from '@/lib/admin'
import { preprocessHtmlForClone } from '@/lib/anthropic'
import { injectBrandImages } from '@/lib/image-injection'
import { generateTextStreaming } from '@/lib/gemini'

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

  const adminOverride = user.is_admin || isAdminEmail(user.email)

  const { data: project } = await supabase
    .from('projects')
    .select('html_content, user_id')
    .eq('id', id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const body = await request.json()
  const { brandName, tagline, primaryColor, secondaryColor, accentColor, logoUrl, brandDescription, headline, subheadline, ctaText } = body

  const strippedHtml = preprocessHtmlForClone(project.html_content ?? '', 15000)

  const prompt = `You are an expert web designer. I have a cloned website's HTML below. Your task is to REBRAND it using the brand details provided — while keeping the original site's visual design, layout, and aesthetic INTACT.

BRAND DETAILS:
- Brand Name: ${brandName}
- Tagline: ${tagline || 'Not provided'}
- Primary Color: ${primaryColor}
- Secondary Color: ${secondaryColor}
- Accent Color: ${accentColor}
- Logo URL: ${logoUrl || 'none — use brand name as styled text'}
- Brand Description: ${brandDescription}
- Hero Headline: ${headline || brandName}
- Hero Subheadline: ${subheadline || tagline || brandDescription}
- CTA Button Text: ${ctaText || 'Get Started'}

CRITICAL RULES — READ CAREFULLY:
1. PRESERVE the original site's visual design EXACTLY — same layout, same spacing, same font styles, same section structure, same overall aesthetic. The output must look like the original site, just rebranded.
2. Only REPLACE: brand name, text content, colors (swap original colors with the brand colors provided), and logo.
3. Do NOT redesign, restructure, or reimagine the layout. Do NOT change font sizes, border radii, card styles, or spacing unless replacing a color.
4. Keep ALL sections in the same order and with the same visual treatment as the original.
5. Replace the original site's color palette with the brand colors: primary color for main accents/buttons/headings, secondary for backgrounds/secondary elements, accent for CTAs and highlights.
6. Replace all text content with brand-appropriate copy based on the brand details — no placeholder text, no lorem ipsum.
7. If a logo URL is provided, use it as <img> in the nav. Otherwise use the brand name as styled text matching the original logo position and style.
8. Keep all images from the original HTML unless a logo URL is provided.
9. Output clean HTML with all CSS inlined in a <style> tag — NO external dependencies.
10. Output ONLY the complete HTML document — no explanation, no markdown, no code blocks.

ORIGINAL SITE HTML (preserve its look and feel exactly — only rebrand):
${strippedHtml}

OUTPUT: Complete rebranded HTML document only. Must look like the original site with new brand applied.`

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
        let fullHtml = ''

        await generateTextStreaming(prompt, {
          maxTokens: 16000,
          onChunk: (chunk) => {
            fullHtml += chunk
            send({ htmlChunk: chunk })
          },
        })

        // Clean up any markdown code fences
        fullHtml = fullHtml
          .replace(/^```html\n?/i, '')
          .replace(/^```\n?/, '')
          .replace(/\n?```$/, '')
          .trim()

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
