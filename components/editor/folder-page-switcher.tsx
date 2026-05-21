'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, FileText, Loader2, FolderOpen, FolderPlus, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SiblingProject {
  id: string
  name: string
  status?: string
}

interface Folder {
  id: string
  name: string
}

interface FolderPageSwitcherProps {
  projectId: string
  folderId: string | null | undefined
  projectName: string
  onFolderChanged?: (folderId: string | null) => void
}

export function FolderPageSwitcher({ projectId, folderId, projectName, onFolderChanged }: FolderPageSwitcherProps) {
  const router = useRouter()
  const [pages, setPages] = useState<SiblingProject[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!folderId) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/folders/${folderId}/projects`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) { setPages(data.projects ?? []); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [folderId])

  const loadFolders = async () => {
    if (folders.length > 0) return
    try {
      const res = await fetch('/api/folders')
      const data = await res.json()
      setFolders(data.folders ?? [])
    } catch { /* silently fail */ }
  }

  const handleAssignFolder = async (targetFolderId: string) => {
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: targetFolderId }),
      })
      onFolderChanged?.(targetFolderId)
      router.refresh()
    } catch { /* silently fail */ }
  }

  const handleCreateFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (res.ok && data.folder) {
        await handleAssignFolder(data.folder.id)
        setFolders((prev) => [...prev, data.folder])
        setNewFolderName('')
        setShowNewFolder(false)
      }
    } catch { /* silently fail */ }
    finally { setCreating(false) }
  }

  const currentFolder = folderId ? (folders.find(f => f.id === folderId) ?? null) : null
  const siblings = pages.filter((p) => p.id !== projectId)

  if (folderId && loading) {
    return (
      <div className="flex items-center gap-1 text-xs text-neutral-400 flex-shrink-0">
        <Loader2 className="w-3 h-3 animate-spin" />
      </div>
    )
  }

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) loadFolders() }}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-7 px-2 text-xs gap-1.5 flex-shrink-0 max-w-44',
            folderId
              ? 'border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300'
              : 'border-dashed border-neutral-300 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400'
          )}
          title={folderId ? 'Switch page in folder' : 'Add to folder'}
        >
          {folderId ? (
            <FolderOpen className="w-3 h-3 flex-shrink-0" />
          ) : (
            <FolderPlus className="w-3 h-3 flex-shrink-0" />
          )}
          <span className="truncate">
            {folderId ? (siblings.length > 0 ? `+${siblings.length} pages` : 'Folder') : 'Add to folder'}
          </span>
          <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52 max-w-72">
        {/* Current page */}
        <div className="px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 font-medium">
          Current page
        </div>
        <DropdownMenuItem className="bg-neutral-100 dark:bg-neutral-800 font-medium" disabled>
          <FileText className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400 mr-2" />
          <span className="truncate">{projectName}</span>
        </DropdownMenuItem>

        {/* Sibling pages */}
        {siblings.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 font-medium">
              Other pages in folder
            </div>
            {siblings.map((page) => (
              <DropdownMenuItem
                key={page.id}
                onClick={() => router.push(`/editor/${page.id}`)}
                className="flex items-center gap-2"
              >
                <FileText className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
                <span className="truncate">{page.name}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}

        <DropdownMenuSeparator />

        {/* Assign to existing folder */}
        {folders.filter(f => f.id !== folderId).length > 0 && (
          <>
            <div className="px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 font-medium">
              Move to folder
            </div>
            {folders.filter(f => f.id !== folderId).map((folder) => (
              <DropdownMenuItem
                key={folder.id}
                onClick={() => handleAssignFolder(folder.id)}
                className="flex items-center gap-2"
              >
                <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
                <span className="truncate">{folder.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}

        {/* Create new folder */}
        {showNewFolder ? (
          <div className="px-2 py-1.5 flex items-center gap-1.5">
            <input
              ref={inputRef}
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder()
                if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName('') }
              }}
              placeholder="Folder name…"
              className="flex-1 h-7 text-xs px-2 rounded border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white outline-none focus:border-purple-400"
            />
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleCreateFolder}
              disabled={creating || !newFolderName.trim()}
            >
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : 'OK'}
            </Button>
          </div>
        ) : (
          <DropdownMenuItem
            onClick={(e) => { e.preventDefault(); setShowNewFolder(true) }}
            className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300"
          >
            <Plus className="w-3.5 h-3.5 flex-shrink-0" />
            New folder
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
