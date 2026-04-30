import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { Resend } from 'resend'
import { createServiceClient, uploadThumbnail } from '@/lib/supabase'
import { scrapeWebsite } from '@/lib/playwright'
import { generateCloneStreaming, injectImageUrls } from '@/lib/anthropic'
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

  // ── Race-condition guard ───────────────────────────────────────────────
  // The DOM pipeline in /api/clone fires async and may finish before or after
  // this request arrives.  Poll for up to 10 s (1 s intervals) before claiming
  // the project.  If the DOM pipeline completes the project in that window we
  // return its HTML immediately without running the screenshot pipeline at all.
  {
    const POLL_INTERVAL_MS = 1000
    const POLL_MAX_MS = 10000
    let waited = 0
    while (waited < POLL_MAX_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      waited += POLL_INTERVAL_MS

      const { data: latest } = await supabase
        .from('projects')
        .select('status, html_content')
        .eq('id', id)
        .single()

      if (latest?.status === 'complete') {
        // DOM pipeline beat us — stream the finished HTML and exit
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(makeEvent({ done: true, html: latest.html_content }))
            controller.close()
          },
        })
        return new Response(stream, { headers: SSE_HEADERS })
      }

      // Still pending — keep waiting
      if (latest?.status === 'pending') continue

      // Any other status (processing, error) — stop polling and fall through
      break
    }
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
          .select('id, tokens_used, clones_count, email, plan, free_clones_used')
          .eq('id', project.user_id)
          .single()

        // ── Scrape (always fresh — no cache) ────────────────────────────
        console.log(`[SCRAPE] Fresh scrape for ${url}`)
        const scrapeResult = await scrapeWebsite(url, (step) => send({ step }), id)

        // ── Generate with Claude ─────────────────────────────────────────
        const screenshotBytes = Math.round(scrapeResult.screenshotBase64.length * 0.75)
        console.log(`[GENERATE] Using screenshot approach - screenshot size: ${screenshotBytes} bytes`)
        send({ step: 'Generating clone with AI...' })
        let html: string
        let tokensUsed: number
        let tokenToUrl: Map<string, string>

        ;({ html, tokensUsed, tokenToUrl } = await generateCloneStreaming(
          scrapeResult.html,
          scrapeResult.screenshotBase64,
          url,
          // Throttled DB save — partial text is raw Claude output (tokens not yet
          // replaced). That is acceptable for mid-stream saves; the final save
          // below always writes fully-resolved HTML.
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
        // injectImageUrls was already called inside generateCloneStreaming, but
        // we call it again here as a guarantee — ensuring the DB save always
        // receives fully-resolved URLs regardless of any internal code path.
        const finalHtml = injectImageUrls(html, tokenToUrl)

        // Confirm R2 URLs are present before writing to DB
        const r2Urls = [...tokenToUrl.values()]
        const hasR2Urls = r2Urls.length === 0 || r2Urls.some((u) => finalHtml.includes(u))
        console.log(`[DB SAVE] HTML contains R2 URLs: ${hasR2Urls}`)

        const projectName = scrapeResult.title || extractDomain(url) || new URL(url).hostname

        await supabase
          .from('projects')
          .update({ name: projectName, html_content: finalHtml, status: 'complete' })
          .eq('id', id)

        const pngBuffer = Buffer.from(scrapeResult.screenshotBase64, 'base64')
        const thumbnailUrl = await uploadThumbnail(id, pngBuffer)
        if (thumbnailUrl) {
          await supabase.from('projects').update({ thumbnail_url: thumbnailUrl }).eq('id', id)
        }

        if (user) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const userUpdate: Record<string, any> = {
            tokens_used: (user.tokens_used || 0) + tokensUsed,
            clones_count: (user.clones_count || 0) + 1,
          }
          if (user.plan === 'free') {
            userUpdate.free_clones_used = (user.free_clones_used || 0) + 1
          }
          await supabase.from('users').update(userUpdate).eq('id', user.id)
        }

        await supabase.from('project_versions').insert({
          project_id: id,
          html_content: finalHtml,
          version_number: 1,
        })

        send({ done: true, html: finalHtml })

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
