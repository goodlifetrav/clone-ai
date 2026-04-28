import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { streamRegistry } from '@/lib/stream-registry'

/**
 * GET /api/projects/[id]/stream
 *
 * Server-Sent Events endpoint. The editor subscribes here when a project is
 * processing. Events:
 *   { htmlChunk: string }  — accumulated HTML so far (fires on every Claude delta)
 *   { done: true, html: string } — generation complete with final cleaned HTML
 *   { error: string }      — generation failed
 */
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
    .select('html_content, status')
    .eq('id', id)
    .single()

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const encoder = new TextEncoder()

  function send(controller: ReadableStreamDefaultController, data: object) {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    } catch {
      // client disconnected
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      // Already finished — return current state immediately
      if (project.status === 'complete') {
        send(controller, { done: true, html: project.html_content })
        controller.close()
        return
      }
      if (project.status === 'error') {
        send(controller, { error: 'Generation failed' })
        controller.close()
        return
      }

      // Look up the in-process stream entry
      const entry = streamRegistry.get(id)

      if (!entry) {
        // Race: generation finished between the DB read and now — re-fetch
        supabase
          .from('projects')
          .select('html_content, status')
          .eq('id', id)
          .single()
          .then(({ data }) => {
            if (data?.html_content) send(controller, { htmlChunk: data.html_content })
            send(controller, { done: true, html: data?.html_content ?? '' })
            try { controller.close() } catch { /* already closed */ }
          })
        return
      }

      // Send whatever has accumulated so far so the editor isn't blank
      if (entry.latestHtml) {
        send(controller, { htmlChunk: entry.latestHtml })
      } else if (project.html_content) {
        send(controller, { htmlChunk: project.html_content })
      }

      // Subscribe to future chunks
      const onHtml = (html: string) => send(controller, { htmlChunk: html })
      const onDone = ({ html }: { html: string }) => {
        send(controller, { done: true, html })
        cleanup()
        try { controller.close() } catch { /* already closed */ }
      }
      const onError = (msg: string) => {
        send(controller, { error: msg })
        cleanup()
        try { controller.close() } catch { /* already closed */ }
      }

      const cleanup = () => {
        entry.emitter.off('html', onHtml)
        entry.emitter.off('done', onDone)
        entry.emitter.off('streamError', onError)
      }

      entry.emitter.on('html', onHtml)
      entry.emitter.on('done', onDone)
      entry.emitter.on('streamError', onError)

      // Clean up listeners if the client disconnects
      request.signal.addEventListener('abort', () => {
        cleanup()
        try { controller.close() } catch { /* already closed */ }
      })
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
