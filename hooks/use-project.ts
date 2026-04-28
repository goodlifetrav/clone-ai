'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Project, ProjectVersion, ChatMessage } from '@/types'

export function useProject(projectId: string) {
  const [project, setProject] = useState<Project | null>(null)
  const [versions, setVersions] = useState<ProjectVersion[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  // Silent refresh — does not set loading:true so the UI doesn't flash
  const silentRefetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`)
      if (!res.ok) return
      const data = await res.json()
      setProject(data.project)
    } catch {
      // silently fail
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

  // Poll every 1.5 seconds while the project is still being processed
  // so the editor shows the HTML being built in near real-time.
  useEffect(() => {
    if (!project || project.status !== 'processing') return

    const interval = setInterval(() => {
      silentRefetch()
    }, 1500)

    return () => clearInterval(interval)
  }, [project?.status, silentRefetch])

  // When status transitions from processing → complete, load versions too
  useEffect(() => {
    if (project?.status === 'complete' && versions.length === 0) {
      fetchVersions()
    }
  }, [project?.status, versions.length, fetchVersions])

  return {
    project,
    versions,
    messages,
    setMessages,
    loading,
    error,
    updateHtml,
    saveVersion,
    restoreVersion,
    refetch: fetchProject,
  }
}
