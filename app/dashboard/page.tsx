'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { Header } from '@/components/header'
import { ProjectCard } from '@/components/project-card'
import { UrlInput } from '@/components/url-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Loader2,
  FolderOpen,
  Folder,
  Search,
  Plus,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  FolderPlus,
} from 'lucide-react'
import type { Project, Folder as FolderType } from '@/types'
import { cn } from '@/lib/utils'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'

export default function DashboardPage() {
  const { isSignedIn, isLoaded } = useUser()
  const router = useRouter()

  const [projects, setProjects] = useState<Project[]>([])
  const [folders, setFolders] = useState<FolderType[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Folder UI state
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [deletingFolder, setDeletingFolder] = useState<FolderType | null>(null)
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null)
  const dragProjectId = useRef<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isLoaded && !isSignedIn) router.push('/')
  }, [isLoaded, isSignedIn, router])

  useEffect(() => {
    if (!isSignedIn) return
    fetchAll()
  }, [isSignedIn])

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [projRes, folderRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/folders'),
      ])
      const [projData, folderData] = await Promise.all([projRes.json(), folderRes.json()])
      setProjects(projData.projects || [])
      setFolders(folderData.folders || [])
    } catch {
      // silently fail
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // Poll while processing
  useEffect(() => {
    const hasProcessing = projects.some((p) => p.status === 'processing')
    if (hasProcessing) {
      pollRef.current = setInterval(() => fetchAll(true), 4000)
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [projects, fetchAll])

  // ── Folder CRUD ─────────────────────────────────────────────────────────
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setFolders((prev) => [...prev, data.folder])
        setExpandedFolders((prev) => new Set([...prev, data.folder.id]))
      }
    } catch { /* ignore */ }
    setNewFolderName('')
    setCreatingFolder(false)
  }

  const handleRenameFolder = async (id: string) => {
    if (!renameName.trim()) { setRenamingFolder(null); return }
    try {
      const res = await fetch(`/api/folders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameName.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setFolders((prev) => prev.map((f) => (f.id === id ? data.folder : f)))
      }
    } catch { /* ignore */ }
    setRenamingFolder(null)
  }

  const handleDeleteFolder = async (id: string) => {
    try {
      await fetch(`/api/folders/${id}`, { method: 'DELETE' })
      setFolders((prev) => prev.filter((f) => f.id !== id))
      setProjects((prev) => prev.map((p) => (p.folder_id === id ? { ...p, folder_id: null } : p)))
    } catch { /* ignore */ }
    setDeletingFolder(null)
  }

  // ── Project actions ──────────────────────────────────────────────────────
  const handleDelete = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id))
  }

  const handleFork = (newId: string) => {
    router.push(`/editor/${newId}`)
  }

  const moveProjectToFolder = async (projectId: string, folderId: string | null) => {
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: folderId }),
      })
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, folder_id: folderId } : p))
      )
    } catch { /* ignore */ }
  }

  // ── Drag-and-drop ────────────────────────────────────────────────────────
  const handleDragStart = (projectId: string) => {
    dragProjectId.current = projectId
  }

  const handleDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    setDragOverFolder(folderId)
  }

  const handleDrop = (e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    setDragOverFolder(null)
    if (dragProjectId.current) {
      moveProjectToFolder(dragProjectId.current, folderId)
      dragProjectId.current = null
      // Expand folder so user sees the project appear
      setExpandedFolders((prev) => new Set([...prev, folderId]))
    }
  }

  const handleDragEnd = () => {
    dragProjectId.current = null
    setDragOverFolder(null)
  }

  // ── Filtering ────────────────────────────────────────────────────────────
  const filteredProjects = search
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.url.toLowerCase().includes(search.toLowerCase())
      )
    : null // null = show folder-organised view

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
      </div>
    )
  }

  const rootProjects = projects.filter((p) => !p.folder_id)
  const projectsInFolder = (folderId: string) => projects.filter((p) => p.folder_id === folderId)

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <Header />

      <main className="pt-20 max-w-7xl mx-auto px-4 sm:px-6 py-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">My Projects</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
              {projects.length} project{projects.length !== 1 ? 's' : ''}
              {folders.length > 0 && ` · ${folders.length} folder${folders.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="max-w-md w-full">
            <UrlInput />
          </div>
        </div>

        {/* Toolbar: search + new folder */}
        <div className="flex items-center gap-3 mb-6">
          {projects.length > 0 && (
            <div className="relative max-w-xs flex-1 sm:flex-none">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <Input
                placeholder="Search projects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs h-9 flex-shrink-0"
            onClick={() => { setCreatingFolder(true); setNewFolderName('') }}
          >
            <FolderPlus className="w-4 h-4" />
            <span className="hidden sm:inline">New Folder</span>
          </Button>
        </div>

        {/* New folder input */}
        {creatingFolder && (
          <div className="flex items-center gap-2 mb-4 max-w-xs">
            <Input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder()
                if (e.key === 'Escape') setCreatingFolder(false)
              }}
            />
            <Button size="sm" className="h-8 px-3" onClick={handleCreateFolder}>
              <Plus className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={() => setCreatingFolder(false)}
            >
              ✕
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
          </div>
        ) : (
          <>
            {/* Search results — flat grid */}
            {filteredProjects !== null ? (
              filteredProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <FolderOpen className="w-10 h-10 text-neutral-300 dark:text-neutral-600 mb-3" />
                  <p className="text-sm text-neutral-500">No projects match your search</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {filteredProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      folders={folders}
                      onDelete={handleDelete}
                      onFork={handleFork}
                      onMoveToFolder={moveProjectToFolder}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                </div>
              )
            ) : (
              <>
                {/* ── Folders ───────────────────────────────────────────── */}
                {folders.map((folder) => {
                  const folderProjects = projectsInFolder(folder.id)
                  const isExpanded = expandedFolders.has(folder.id)
                  const isDragTarget = dragOverFolder === folder.id

                  return (
                    <div key={folder.id} className="mb-4">
                      {/* Folder header row */}
                      <div
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors cursor-pointer select-none',
                          isDragTarget
                            ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30'
                            : 'border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        )}
                        onClick={() =>
                          setExpandedFolders((prev) => {
                            const next = new Set(prev)
                            if (next.has(folder.id)) next.delete(folder.id)
                            else next.add(folder.id)
                            return next
                          })
                        }
                        onDragOver={(e) => handleDragOver(e, folder.id)}
                        onDragLeave={() => setDragOverFolder(null)}
                        onDrop={(e) => handleDrop(e, folder.id)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                        )}
                        <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />

                        {renamingFolder === folder.id ? (
                          <Input
                            autoFocus
                            value={renameName}
                            onChange={(e) => setRenameName(e.target.value)}
                            className="h-6 text-sm py-0 flex-1 max-w-xs"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              if (e.key === 'Enter') handleRenameFolder(folder.id)
                              if (e.key === 'Escape') setRenamingFolder(null)
                            }}
                            onBlur={() => handleRenameFolder(folder.id)}
                          />
                        ) : (
                          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200 flex-1">
                            {folder.name}
                          </span>
                        )}

                        <span className="text-xs text-neutral-400 flex-shrink-0">
                          {folderProjects.length}
                        </span>

                        {/* Folder actions */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 flex-shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="w-3 h-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation()
                                setRenameName(folder.name)
                                setRenamingFolder(folder.id)
                              }}
                            >
                              <Pencil className="w-4 h-4 mr-2" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 dark:text-red-400"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDeletingFolder(folder)
                              }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete folder
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Folder contents */}
                      {isExpanded && (
                        <div className="mt-3 pl-4 border-l-2 border-neutral-100 dark:border-neutral-800">
                          {folderProjects.length === 0 ? (
                            <p className="text-xs text-neutral-400 dark:text-neutral-500 py-3 pl-2">
                              Empty — drag projects here
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 py-3">
                              {folderProjects.map((project) => (
                                <ProjectCard
                                  key={project.id}
                                  project={project}
                                  folders={folders}
                                  onDelete={handleDelete}
                                  onFork={handleFork}
                                  onMoveToFolder={moveProjectToFolder}
                                  onDragStart={handleDragStart}
                                  onDragEnd={handleDragEnd}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* ── Root projects (no folder) ─────────────────────────── */}
                {rootProjects.length === 0 && folders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
                      <FolderOpen className="w-8 h-8 text-neutral-400 dark:text-neutral-500" />
                    </div>
                    <h3 className="font-semibold text-neutral-900 dark:text-white mb-2">
                      No projects yet
                    </h3>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs">
                      Paste a URL above to clone your first website
                    </p>
                  </div>
                ) : rootProjects.length > 0 ? (
                  <>
                    {folders.length > 0 && (
                      <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-3 mt-2">
                        All projects
                      </p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {rootProjects.map((project) => (
                        <ProjectCard
                          key={project.id}
                          project={project}
                          folders={folders}
                          onDelete={handleDelete}
                          onFork={handleFork}
                          onMoveToFolder={moveProjectToFolder}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                        />
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            )}
          </>
        )}
      </main>

      {deletingFolder && (
        <DeleteConfirmDialog
          title="Delete Folder"
          description={`"${deletingFolder.name}" will be deleted. Projects inside will be moved to root.`}
          onConfirm={() => handleDeleteFolder(deletingFolder.id)}
          onCancel={() => setDeletingFolder(null)}
        />
      )}
    </div>
  )
}
