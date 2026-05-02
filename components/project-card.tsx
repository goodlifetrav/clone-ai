'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { Project, Folder } from '@/types'
import { formatDate, extractDomain } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ExternalLink,
  MoreHorizontal,
  Trash2,
  GitFork,
  Download,
  Loader2,
  FolderInput,
  FolderOpen,
} from 'lucide-react'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'

interface ProjectCardProps {
  project: Project
  folders?: Folder[]
  onDelete?: (id: string) => void
  onFork?: (id: string) => void
  onMoveToFolder?: (projectId: string, folderId: string | null) => void
  onDragStart?: (projectId: string) => void
  onDragEnd?: () => void
}

export function ProjectCard({
  project,
  folders = [],
  onDelete,
  onFork,
  onMoveToFolder,
  onDragStart,
  onDragEnd,
}: ProjectCardProps) {
  const [deleting, setDeleting] = useState(false)
  const [forking, setForking] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const isProcessing = project.status === 'processing'
  const isError = project.status === 'error'

  const handleDelete = async () => {
    setDeleting(true)
    setShowDeleteDialog(false)
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
      if (res.ok) {
        onFork?.(data.project.id)
      } else {
        alert(data.error || 'Failed to fork project')
      }
    } catch {
      alert('Failed to fork project')
    } finally {
      setForking(false)
    }
  }

  const handleDownload = async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/download`)
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || 'Failed to download')
        return
      }
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
    <div
      className="group relative rounded-xl border border-neutral-200 bg-white overflow-hidden hover:shadow-md transition-all duration-200 dark:border-neutral-800 dark:bg-neutral-900 cursor-grab active:cursor-grabbing"
      draggable={!isProcessing && !isError}
      onDragStart={() => onDragStart?.(project.id)}
      onDragEnd={() => onDragEnd?.()}
    >
      {/* Info */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm text-neutral-900 dark:text-white truncate">
              <Link href={`/editor/${project.id}`} className="hover:underline">
                {project.name}
              </Link>
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

              {/* Move to folder */}
              {onMoveToFolder && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <FolderInput className="w-4 h-4 mr-2" />
                    Move to folder
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {project.folder_id && (
                      <DropdownMenuItem
                        onClick={() => onMoveToFolder(project.id, null)}
                      >
                        <FolderOpen className="w-4 h-4 mr-2" />
                        Remove from folder
                      </DropdownMenuItem>
                    )}
                    {folders.length === 0 && (
                      <DropdownMenuItem disabled>No folders yet</DropdownMenuItem>
                    )}
                    {folders
                      .filter((f) => f.id !== project.folder_id)
                      .map((folder) => (
                        <DropdownMenuItem
                          key={folder.id}
                          onClick={() => onMoveToFolder(project.id, folder.id)}
                        >
                          <FolderInput className="w-4 h-4 mr-2" />
                          {folder.name}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 dark:text-red-400"
                onClick={() => setShowDeleteDialog(true)}
                disabled={deleting}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {showDeleteDialog && (
        <DeleteConfirmDialog
          title="Delete Project"
          description={`"${project.name}" will be permanently deleted. This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteDialog(false)}
        />
      )}
    </div>
  )
}
