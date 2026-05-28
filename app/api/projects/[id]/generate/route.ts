import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { reportError } from '@/lib/error-report'


const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await getAuth()
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

  function sseResponse(data: Record<string, unknown>) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(makeEvent(data))
        controller.close()
      },
    })
    return new Response(stream, { headers: SSE_HEADERS })
  }

  // Already complete — return current HTML immediately
  if (project.status === 'complete') {
    return sseResponse({ done: true, html: project.html_content })
  }

  // Already processing (e.g. page refresh during generation) —
  // signal client to poll for completion
  if (project.status === 'processing') {
    const stream = new ReadableStream({
      start(controller) {
        if (project.html_content) {
          controller.enqueue(makeEvent({ htmlChunk: project.html_content }))
        }
        controller.enqueue(makeEvent({ usePolling: true }))
        controller.close()
      },
    })
    return new Response(stream, { headers: SSE_HEADERS })
  }

  // Error state
  if (project.status === 'error') {
    return sseResponse({ error: 'This site could not be cloned. It may have bot protection or take too long to load. Please try a different URL.' })
  }

  // Only start generation for 'pending' projects
  if (project.status !== 'pending') {
    return NextResponse.json({ error: 'Project is not pending' }, { status: 400 })
  }

  // ── DOM pipeline poll ──────────────────────────────────────────────────────
  // The DOM pipeline in /api/clone fires async and may take up to 90s for heavy
  // sites (HubSpot, Apple). Poll until it completes or times out.
  // Stream progress events to the client so the UI doesn't look frozen.
  const POLL_INTERVAL_MS = 2000
  // 90s was too short — Pillar 2 Vision (Gemini + Claude fallback) can add
  // 30-60s on top of normal extraction (~30s with Pass 5c long waits).
  // Bumped to 180s so Vision-needing sites don't time out before completion.
  const POLL_MAX_MS = 180000
  const progressMessages = [
    'Connecting to site...',
    'Loading page content...',
    'Rendering JavaScript...',
    'Capturing page sections...',
    'Processing assets...',
    'Finalizing clone...',
  ]

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try { controller.enqueue(makeEvent(data)) } catch { /* client disconnected */ }
      }

      // safeClose: client may disconnect before our success/error branch
      // calls close(), which makes the raw close() throw "Controller is
      // already closed". Wrap every close so disconnect noise doesn't bubble
      // to the outer catch + Telegram error reporter.
      const safeClose = () => { try { controller.close() } catch { /* already closed */ } }

      try {
        let waited = 0
        let progressIdx = 0

        while (waited < POLL_MAX_MS) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
          waited += POLL_INTERVAL_MS

          // Send progress heartbeat every 4s
          if (waited % 4000 === 0) {
            send({ step: progressMessages[Math.min(progressIdx++, progressMessages.length - 1)] })
          }

          const { data: latest } = await supabase
            .from('projects')
            .select('status, html_content')
            .eq('id', id)
            .single()

          if (latest?.status === 'complete') {
            send({ done: true, html: latest.html_content })
            safeClose()
            return
          }

          if (latest?.status === 'error') {
            send({ error: 'This site could not be cloned. It may have bot protection or take too long to load. Please try a different URL.' })
            safeClose()
            return
          }

          // 'pending' — keep waiting. Any other status falls through.
          if (latest?.status !== 'pending') break
        }

        // Timed out — mark error and notify user
        console.log(`[DOM] Timed out waiting for project ${id} — site could not be cloned`)
        await supabase.from('projects').update({ status: 'error' }).eq('id', id)
        send({ error: 'This site could not be cloned. It may have bot protection or take too long to load. Please try a different URL.' })
      } catch (err) {
        const error = err as Error
        // "Controller is already closed" = benign client-disconnect race.
        // Don't spam Telegram with these; only report real errors.
        const benign = /Controller is already closed/i.test(error.message ?? '')
        if (!benign) {
          console.error('Generate error:', error)
          reportError(err, 'GET /api/projects/[id]/generate', { projectId: id, url: project.url })
          await supabase.from('projects').update({ status: 'error' }).eq('id', id)
          send({ error: error.message || 'Generation failed' })
        }
      } finally {
        safeClose()
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
