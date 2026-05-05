import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { isAdminEmail } from '@/lib/admin'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, plan, is_admin, email')
    .eq('clerk_id', userId)
    .single()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const adminOverride = user.is_admin || isAdminEmail(user.email)
  if (user.plan === 'free' && !adminOverride) {
    return NextResponse.json({ error: 'Upgrade to Pro to use AI Rebuild', upgradeRequired: true }, { status: 403 })
  }

  const { data: project } = await supabase
    .from('projects')
    .select('html_content, user_id')
    .eq('id', id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const body = await request.json()
  const { brandName, tagline, primaryColor, secondaryColor, accentColor, logoUrl, brandDescription, headline, subheadline, ctaText } = body

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Gemini API key not configured' }, { status: 500 })

  // Truncate HTML to avoid token limits — Gemini 2.5 Pro handles ~1M tokens but let's be safe
  const truncatedHtml = project.html_content?.slice(0, 80000) ?? ''

  const prompt = `You are an expert web designer. I have a cloned website's HTML below. Your task is to redesign it as a clean, modern, fully self-contained webpage using the brand details provided.

BRAND DETAILS:
- Brand Name: ${brandName}
- Tagline: ${tagline || 'Not provided'}
- Primary Color: ${primaryColor}
- Secondary Color: ${secondaryColor}
- Accent Color: ${accentColor}
- Logo URL: ${logoUrl || 'none — use brand name as text logo'}
- Brand Description: ${brandDescription}
- Hero Headline: ${headline || brandName}
- Hero Subheadline: ${subheadline || tagline || brandDescription}
- CTA Button Text: ${ctaText || 'Get Started'}

INSTRUCTIONS:
1. Keep the same page STRUCTURE and SECTIONS as the original (nav, hero, features, testimonials, footer etc)
2. Replace ALL text content with the brand details above — no placeholder text
3. Use the brand colors throughout — primary for main elements, secondary for backgrounds/accents, accent for CTAs and highlights
4. Output clean, modern HTML with all CSS inlined in a <style> tag — NO external dependencies, NO CDN links
5. Make it fully responsive with mobile-friendly design
6. If a logo URL is provided, use it as an <img> in the nav. Otherwise use the brand name as styled text
7. Remove any scripts that reference the original site's functionality
8. Output ONLY the complete HTML document — no explanation, no markdown, no code blocks

ORIGINAL SITE HTML:
${truncatedHtml}

OUTPUT: Complete redesigned HTML document only.`

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { /* client disconnected */ }
      }

      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 65536, temperature: 0.7 },
            }),
          }
        )

        if (!geminiRes.ok) {
          const errText = await geminiRes.text()
          throw new Error(`Gemini API error: ${errText}`)
        }

        const reader = geminiRes.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let fullHtml = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const jsonStr = line.slice(6).trim()
            if (!jsonStr || jsonStr === '[DONE]') continue

            try {
              const parsed = JSON.parse(jsonStr)
              const chunk = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
              if (chunk) {
                fullHtml += chunk
                send({ htmlChunk: chunk })
              }
            } catch { /* malformed chunk, skip */ }
          }
        }

        // Clean up any markdown code fences Gemini might add
        fullHtml = fullHtml
          .replace(/^```html\n?/i, '')
          .replace(/^```\n?/, '')
          .replace(/\n?```$/, '')
          .trim()

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
