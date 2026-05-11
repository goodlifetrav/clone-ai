import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { generateText } from '@/lib/gemini'
import { injectBrandImages } from '@/lib/image-injection'

/**
 * Prepare HTML for Gemini rebuild.
 * Strip <style> tag contents (Framer CSS alone is 1.2MB — Gemini cannot reproduce it
 * and trying to do so causes MAX_TOKENS truncation after ~11% of the page).
 * Keep inline style="" attributes so Gemini understands layout positioning.
 * Keep all HTML structure, text content, and image URLs.
 * This is what Gemini web does when you paste HTML manually — it reads the structure
 * and generates a fresh page, it does NOT try to copy 1.4MB of compiled CSS.
 */
function prepareHtmlForRebrand(html: string): string {
  let result = html
  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  result = result.replace(/<!--[\s\S]*?-->/g, '')
  result = result.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
  // Strip style tag CONTENTS only — keep inline style="" attributes
  result = result.replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, '$1$2')
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
  console.log(`[rebuild] HTML size sent to Gemini: ${preparedHtml.length} chars`)

  const prompt = `You are rebuilding a website for a new brand. Study the HTML below to understand the layout, sections, and content structure — then generate a completely fresh, clean HTML page using Tailwind CSS (from CDN) that replicates that same layout for the new brand.

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
1. Read the original HTML to understand the page structure: how many sections, what each section contains, navigation links, hero area, feature sections, testimonials, pricing, footer, etc.
2. Build a FRESH HTML page using Tailwind CSS (include <script src="https://cdn.tailwindcss.com"></script>) that has the same sections in the same order
3. Replace all text and copy with brand-appropriate content for ${brandName}
4. Use the brand colors: primary ${primaryColor} for buttons/headings/accents, secondary ${secondaryColor || '#ffffff'} for backgrounds
5. Keep images from the original HTML (same img src URLs)
6. DO NOT copy Framer class names or any original CSS — use only Tailwind utility classes
7. Output ONLY the complete HTML document — no explanation, no markdown, no code fences

ORIGINAL HTML TO STUDY:
${preparedHtml}`

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { /* client disconnected */ }
      }

      // Keepalive every 3s so the SSE connection stays open while Gemini processes
      const keepalive = setInterval(() => send({ status: 'thinking' }), 3000)

      try {
        send({ status: 'thinking' })

        // Use non-streaming generateText to avoid stream-parse failures on large inputs.
        // This matches how Gemini web works when you paste HTML manually.
        const { text: rawHtml } = await generateText(prompt, { maxTokens: 131072, disableThinking: true })
        console.log(`[rebuild] Gemini returned ${rawHtml.length} chars`)
        console.log(`[rebuild] First 300 chars: ${rawHtml.slice(0, 300)}`)

        // Find where actual HTML starts — this strips any code fences, preamble, or whitespace
        const htmlStartIdx = /<!DOCTYPE html/i.test(rawHtml)
          ? rawHtml.search(/<!DOCTYPE html/i)
          : rawHtml.search(/<html/i)
        let fullHtml = htmlStartIdx >= 0
          ? rawHtml.slice(htmlStartIdx).replace(/\s*```\s*$/, '').trim()
          : rawHtml.replace(/\s*```\s*$/, '').trim()

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
