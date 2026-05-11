import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { generateTextStreaming } from '@/lib/gemini'
import { injectBrandImages } from '@/lib/image-injection'

/**
 * Strip only scripts/comments from the HTML so Gemini receives the real
 * structure, CSS, and content — just like pasting it manually into Gemini.
 */
function prepareHtmlForRebrand(html: string, maxChars = 150000): string {
  let result = html
  // Remove scripts
  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  // Remove inlined CSS — after CSS inlining this can be 800k+ chars of compiled
  // CSS that consumes the entire context budget, leaving no room for HTML structure.
  // Gemini generates its own CSS for the rebuilt page anyway.
  result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  // Remove HTML comments and noscript
  result = result.replace(/<!--[\s\S]*?-->/g, '')
  result = result.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
  // Collapse whitespace
  result = result.replace(/\s+/g, ' ').trim()
  if (result.length > maxChars) result = result.slice(0, maxChars)
  return result
}

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

  const preparedHtml = prepareHtmlForRebrand(project.html_content ?? '')

  const prompt = `Take this HTML code and use it as a base to rebuild a website for the brand described below. Keep the exact same layout, sections, visual structure, and design patterns from the original HTML — only change the brand name, text content, colors, and logo.

BRAND DETAILS:
- Brand Name: ${brandName}
- Tagline: ${tagline || 'Not provided'}
- Primary Color: ${primaryColor}
- Secondary Color: ${secondaryColor || 'Not provided'}
- Accent Color: ${accentColor || 'Not provided'}
- Logo: ${logoUrl ? `Use this image URL as the logo: ${logoUrl}` : 'Use brand name as styled text in the nav'}
- Description: ${brandDescription}
- Hero Headline: ${headline || brandName}
- Hero Subheadline: ${subheadline || tagline || brandDescription}
- CTA Button Text: ${ctaText || 'Get Started'}

INSTRUCTIONS:
1. Keep the EXACT same layout, section order, visual structure, and design patterns from the original HTML below
2. Replace all text with brand-appropriate copy based on the brand details above
3. Replace the original color palette with the brand colors (primary for main accents/buttons/headings, secondary for backgrounds, accent for CTAs)
4. Keep all images from the original unless a logo URL is provided
5. Output ONLY the complete HTML document — no explanation, no markdown, no code fences

ORIGINAL HTML:
${preparedHtml}`

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
          maxTokens: 65536,
          onReset: () => { fullHtml = '' },
          onChunk: (chunk) => {
            fullHtml += chunk
            // Only stream once we have valid HTML started
            const htmlStart = /<!DOCTYPE html/i.test(fullHtml)
              ? fullHtml.search(/<!DOCTYPE html/i)
              : fullHtml.search(/<html/i)
            if (htmlStart >= 0) {
              send({ htmlChunk: chunk })
            }
          },
        })

        // Strip any markdown code fences Gemini might add
        fullHtml = fullHtml
          .replace(/^```html\n?/i, '')
          .replace(/^```\n?/, '')
          .replace(/\n?```$/, '')
          .trim()

        // Extract just the HTML portion
        const htmlStart = /<!DOCTYPE html/i.test(fullHtml)
          ? fullHtml.search(/<!DOCTYPE html/i)
          : fullHtml.search(/<html/i)
        if (htmlStart > 0) fullHtml = fullHtml.slice(htmlStart)

        if (!fullHtml || !/<html/i.test(fullHtml)) {
          send({ error: 'Gemini did not return valid HTML. Please try again.' })
          return
        }

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
