'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Project, ProjectVersion, ChatMessage } from '@/types'

export function useProject(projectId: string) {
  const [project, setProject] = useState<Project | null>(null)
  const [versions, setVersions] = useState<ProjectVersion[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Exposed so split-view can drive the CodeEditor scroll-to-bottom behaviour
  const [isStreaming, setIsStreaming] = useState(false)

  const fetchProject = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/projects/${projectId}`)
      if (!res.ok) throw new Error('Failed to load project')
      const data = await res.json()
      setProject(data.project)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const fetchVersions = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`)
      if (!res.ok) return
      const data = await res.json()
      setVersions(data.versions || [])
    } catch {
      // silently fail
    }
  }, [projectId])

  const updateHtml = useCallback(
    async (html: string) => {
      if (!project) return
      setProject((prev) => (prev ? { ...prev, html_content: html } : prev))

      try {
        await fetch(`/api/projects/${projectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html_content: html }),
        })
      } catch {
        // silently fail — local state is updated
      }
    },
    [project, projectId]
  )

  const saveVersion = useCallback(async () => {
    if (!project) return
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html_content: project.html_content }),
      })
      if (res.ok) {
        await fetchVersions()
      }
    } catch {
      // silently fail
    }
  }, [project, projectId, fetchVersions])

  const restoreVersion = useCallback(
    async (version: ProjectVersion) => {
      await updateHtml(version.html_content)
    },
    [updateHtml]
  )

  useEffect(() => {
    fetchProject()
    fetchVersions()
  }, [fetchProject, fetchVersions])

  // ── Real-time stream subscription while project is processing ─────────────
  // Subscribes to GET /api/projects/[id]/stream (SSE backed by an in-process
  // EventEmitter in the clone route) so HTML appears character-by-character
  // without any polling delay.
  const streamingRef = useRef(false)

  useEffect(() => {
    if (!project || project.status !== 'processing') {
      if (streamingRef.current) {
        setIsStreaming(false)
        streamingRef.current = false
      }
      return
    }

    // Avoid opening a second stream if one is already running
    if (streamingRef.current) return
    streamingRef.current = true
    setIsStreaming(true)

    const abortController = new AbortController()

    async function subscribe() {
      try {
        const res = await fetch(`/api/projects/${projectId}/stream`, {
          signal: abortController.signal,
        })

        if (!res.ok || !res.body) {
          // Server not available — fall back to 1.5s polling
          fallbackPoll(abortController.signal)
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const text = line.slice(6).trim()
            if (!text) continue

            let event: Record<string, unknown>
            try { event = JSON.parse(text) } catch { continue }

            if (event.htmlChunk) {
              setProject((prev) =>
                prev ? { ...prev, html_content: event.htmlChunk as string } : prev
              )
            }

            if (event.done) {
              setProject((prev) =>
                prev
                  ? { ...prev, html_content: event.html as string, status: 'complete' }
                  : prev
              )
              setIsStreaming(false)
              streamingRef.current = false
              await fetchVersions()
              return
            }

            if (event.error) {
              setProject((prev) => (prev ? { ...prev, status: 'error' } : prev))
              setIsStreaming(false)
              streamingRef.current = false
              return
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return
        // Stream error — fall back to polling
        fallbackPoll(abortController.signal)
      }
    }

    function fallbackPoll(signal: AbortSignal) {
      const interval = setInterval(async () => {
        if (signal.aborted) { clearInterval(interval); return }
        try {
          const res = await fetch(`/api/projects/${projectId}`)
          if (!res.ok) return
          const data = await res.json()
          const p: Project = data.project
          setProject(p)
          if (p.status !== 'processing') {
            clearInterval(interval)
            setIsStreaming(false)
            streamingRef.current = false
            if (p.status === 'complete') fetchVersions()
          }
        } catch { /* silently fail */ }
      }, 1500)
    }

    subscribe()

    return () => {
      abortController.abort()
    }
  // Re-subscribe if project ID changes or status leaves/enters 'processing'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.status, projectId])

  return {
    project,
    versions,
    messages,
    setMessages,
    loading,
    error,
    isStreaming,
    updateHtml,
    saveVersion,
    restoreVersion,
    refetch: fetchProject,
  }
}
