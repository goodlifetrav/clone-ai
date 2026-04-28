'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { Project } from '@/types'
import { formatDate, extractDomain } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ExternalLink,
  MoreHorizontal,
  Trash2,
  GitFork,
  Download,
  Globe,
  Loader2,
  AlertCircle,
} from 'lucide-react'

interface ProjectCardProps {
  project: Project
  onDelete?: (id: string) => void
  onFork?: (id: string) => void
}

export function ProjectCard({ project, onDelete, onFork }: ProjectCardProps) {
  const [deleting, setDeleting] = useState(false)
  const [forking, setForking] = useState(false)

  const isProcessing = project.status === 'processing'
  const isError = project.status === 'error'

  const handleDelete = async () => {
    if (!confirm('Delete this project? This cannot be undone.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      if (res.ok) onDelete?.(project.id)
    } catch {
      alert('Failed to delete project')
    } finally {
      setDeleting(false)
    }
  }

  const handleFork = async () => {
    setForking(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/fork`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) onFork?.(data.project.id)
    } catch {
      alert('Failed to fork project')
    } finally {
      setForking(false)
    }
  }

  const handleDownload = async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/download`)
      if (!res.ok) throw new Error('Failed to download')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${project.name.replace(/\s+/g, '-')}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      alert('Failed to download project')
    }
  }

  return (
    <div className="group relative rounded-xl border border-neutral-200 bg-white overflow-hidden hover:shadow-md transition-all duration-200 dark:border-neutral-800 dark:bg-neutral-900">
      {/* Thumbnail */}
      <Link href={`/editor/${project.id}`}>
        <div className="relative h-40 bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-800 dark:to-neutral-700 overflow-hidden">
          {isProcessing ? (
            // Processing overlay
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-8 h-8 text-neutral-400 animate-spin" />
              <span className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
                Generating…
              </span>
            </div>
          ) : isError ? (
            // Error overlay
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <span className="text-xs text-red-500 font-medium">Failed</span>
            </div>
          ) : project.thumbnail_url ? (
            <img
              src={project.thumbnail_url}
              alt={project.name}
              className="w-full h-full object-cover object-top"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Globe className="w-10 h-10 text-neutral-400 dark:text-neutral-500" />
            </div>
          )}

          {/* Hover overlay (only when not processing/error) */}
          {!isProcessing && !isError && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
              <span className="text-white text-sm font-medium bg-black/60 px-3 py-1.5 rounded-full">
                Open Editor
              </span>
            </div>
          )}

          {/* Status badge */}
          {isProcessing && (
            <div className="absolute top-2 left-2 flex items-center gap-1 bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 text-xs font-medium px-2 py-0.5 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing
            </div>
          )}
          {isError && (
            <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 text-xs font-medium px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" />
              Error
            </div>
          )}
        </div>
      </Link>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm text-neutral-900 dark:text-white truncate">
              {project.name}
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
              {extractDomain(project.url)}
            </p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
              {formatDate(project.updated_at)}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0">
                {deleting || forking ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <MoreHorizontal className="w-3 h-3" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/editor/${project.id}`}>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open Editor
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleFork} disabled={forking || isProcessing}>
                <GitFork className="w-4 h-4 mr-2" />
                Fork Project
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownload} disabled={isProcessing}>
                <Download className="w-4 h-4 mr-2" />
                Download ZIP
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 dark:text-red-400"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
