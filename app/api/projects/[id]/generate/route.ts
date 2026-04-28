import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { Resend } from 'resend'
import { createServiceClient, uploadThumbnail } from '@/lib/supabase'
import { scrapeWebsite } from '@/lib/playwright'
import { generateCloneStreaming } from '@/lib/anthropic'
import { extractDomain } from '@/lib/utils'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = createServiceClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, url, status, html_content, user_id')
    .eq('id', id)
    .single()

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const encoder = new TextEncoder()

  function makeEvent(data: Record<string, unknown>) {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
  }

  // Already complete — return current HTML immediately
  if (project.status === 'complete') {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(makeEvent({ done: true, html: project.html_content }))
        controller.close()
      },
    })
    return new Response(stream, { headers: SSE_HEADERS })
  }

  // Already processing (e.g. page refresh during generation) —
  // send what's in DB so far, then let the hook fall back to fast polling
  if (project.status === 'processing') {
    const stream = new ReadableStream({
      start(controller) {
        if (project.html_content) {
          controller.enqueue(makeEvent({ htmlChunk: project.html_content }))
        }
        // Signal client to use polling for the rest
        controller.enqueue(makeEvent({ usePolling: true }))
        controller.close()
      },
    })
    return new Response(stream, { headers: SSE_HEADERS })
  }

  // Error state
  if (project.status === 'error') {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(makeEvent({ error: 'Generation previously failed' }))
        controller.close()
      },
    })
    return new Response(stream, { headers: SSE_HEADERS })
  }

  // Only start generation for 'pending' projects
  if (project.status !== 'pending') {
    return NextResponse.json({ error: 'Project is not pending' }, { status: 400 })
  }

  // Claim the project — set status to 'processing'
  await supabase.from('projects').update({ status: 'processing' }).eq('id', id)

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(makeEvent(data))
        } catch {
          // client disconnected — continue server-side processing
        }
      }

      try {
        const url = project.url

        const { data: user } = await supabase
          .from('users')
          .select('id, tokens_used, clones_count, email, plan')
          .eq('id', project.user_id)
          .single()

        // ── Scrape (with 24h cache) ─────────────────────────────────────
        let scrapeResult: { html: string; screenshotBase64: string; title: string }

        const cacheWindow = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { data: cachedScrape } = await supabase
          .from('scrape_cache')
          .select('html, screenshot_base64, title')
          .eq('url', url)
          .gte('scraped_at', cacheWindow)
          .order('scraped_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (cachedScrape) {
          send({ step: 'Using cached page data...' })
          scrapeResult = {
            html: cachedScrape.html,
            screenshotBase64: cachedScrape.screenshot_base64,
            title: cachedScrape.title ?? '',
          }
        } else {
          scrapeResult = await scrapeWebsite(url, (step) => send({ step }))
          void supabase.from('scrape_cache').insert({
            url,
            html: scrapeResult.html,
            screenshot_base64: scrapeResult.screenshotBase64,
            title: scrapeResult.title,
          })
        }

        // ── Generate with Claude ─────────────────────────────────────────
        send({ step: 'Generating clone with AI...' })
        let html: string
        let tokensUsed: number

        ;({ html, tokensUsed } = await generateCloneStreaming(
          scrapeResult.html,
          scrapeResult.screenshotBase64,
          url,
          // Throttled DB save (every ~2 000 chars)
          async (partialText) => {
            await supabase
              .from('projects')
              .update({ html_content: partialText })
              .eq('id', id)
          },
          // Every single Claude delta → pushed to client in real time
          (accumulated) => {
            send({ htmlChunk: accumulated })
          }
        ))

        // ── Persist final result ─────────────────────────────────────────
        const projectName = scrapeResult.title || extractDomain(url) || new URL(url).hostname

        await supabase
          .from('projects')
          .update({ name: projectName, html_content: html, status: 'complete' })
          .eq('id', id)

        const pngBuffer = Buffer.from(scrapeResult.screenshotBase64, 'base64')
        const thumbnailUrl = await uploadThumbnail(id, pngBuffer)
        if (thumbnailUrl) {
          await supabase.from('projects').update({ thumbnail_url: thumbnailUrl }).eq('id', id)
        }

        if (user) {
          await supabase
            .from('users')
            .update({
              tokens_used: (user.tokens_used || 0) + tokensUsed,
              clones_count: (user.clones_count || 0) + 1,
            })
            .eq('id', user.id)
        }

        await supabase.from('project_versions').insert({
          project_id: id,
          html_content: html,
          version_number: 1,
        })

        send({ done: true, html })

        // Completion email (non-fatal)
        const resendKey = process.env.RESEND_API_KEY
        const userEmail = user?.email
        if (resendKey && userEmail) {
          try {
            const resend = new Resend(resendKey)
            const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
            await resend.emails.send({
              from: 'IgualAI <noreply@igualai.com>',
              to: userEmail,
              subject: 'Your clone is ready!',
              html: `<p>Your clone of <strong>${url}</strong> is ready.</p><p><a href="${appUrl}/editor/${id}">Open in editor</a></p>`,
            })
          } catch {
            // non-fatal
          }
        }
      } catch (err) {
        const error = err as Error
        console.error('Generate error:', error)
        await supabase.from('projects').update({ status: 'error' }).eq('id', id)
        send({ error: error.message || 'Generation failed' })
      } finally {
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
