'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Project, ProjectVersion, ChatMessage } from '@/types'

export function useProject(projectId: string) {
  const [project, setProject] = useState<Project | null>(null)
  const [versions, setVersions] = useState<ProjectVersion[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
      setProject((prev) => (prev ? { ...prev, html_content: html } : prev))
      try {
        await fetch(`/api/projects/${projectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html_content: html }),
        })
      } catch {
        // silently fail
      }
    },
    [projectId]
  )

  const saveVersion = useCallback(async () => {
    if (!project) return
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html_content: project.html_content }),
      })
      if (res.ok) await fetchVersions()
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

  useEffect(() => {
    if (!project) return
    fetch(`/api/chat/history?projectId=${projectId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.messages?.length) return
        setMessages(
          data.messages.map((m: { role: 'user' | 'assistant'; content: string; created_at: string }) => ({
            role: m.role,
            content: m.content,
          }))
        )
      })
      .catch(() => {/* silently fail */})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  // ── Streaming / polling while project is generating ────────────────────────
  const streamStartedRef = useRef(false)

  useEffect(() => {
    if (!project) return

    const status = project.status

    // Nothing to do for completed/errored projects
    if (status !== 'pending' && status !== 'processing') {
      if (streamStartedRef.current) {
        setIsStreaming(false)
        streamStartedRef.current = false
      }
      return
    }

    // Avoid starting a second stream
    if (streamStartedRef.current) return
    streamStartedRef.current = true
    setIsStreaming(true)

    const abortController = new AbortController()

    if (status === 'pending') {
      // ── PENDING: subscribe directly to the SSE generate stream ──────────
      subscribeThroughSSE(abortController.signal)
    } else {
      // ── PROCESSING: another request already started it — fast-poll DB ───
      // (e.g. page refresh mid-generation)
      startFastPoll(abortController.signal)
    }

    async function subscribeThroughSSE(signal: AbortSignal) {
      try {
        const res = await fetch(`/api/projects/${projectId}/generate`, { signal })

        if (!res.ok || !res.body) {
          startFastPoll(signal)
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

            if (event.usePolling) {
              // Server told us to switch to polling (already processing in another context)
              startFastPoll(signal)
              return
            }

            if (event.done) {
              setProject((prev) =>
                prev
                  ? { ...prev, html_content: event.html as string, status: 'complete' }
                  : prev
              )
              setIsStreaming(false)
              streamStartedRef.current = false
              await fetchVersions()
              return
            }

            if (event.error) {
              setProject((prev) => (prev ? { ...prev, status: 'error' } : prev))
              setIsStreaming(false)
              streamStartedRef.current = false
              return
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return
        startFastPoll(abortController.signal)
      }
    }

    function startFastPoll(signal: AbortSignal) {
      const interval = setInterval(async () => {
        if (signal.aborted) { clearInterval(interval); return }
        try {
          const res = await fetch(`/api/projects/${projectId}`)
          if (!res.ok) return
          const data = await res.json()
          const p: Project = data.project
          setProject(p)
          if (p.status !== 'pending' && p.status !== 'processing') {
            clearInterval(interval)
            setIsStreaming(false)
            streamStartedRef.current = false
            if (p.status === 'complete') fetchVersions()
          }
        } catch { /* silently fail */ }
      }, 500)
    }

    return () => {
      abortController.abort()
    }
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
