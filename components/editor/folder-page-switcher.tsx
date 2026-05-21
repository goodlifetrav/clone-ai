'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, FileText, Loader2, FolderOpen } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SiblingProject {
  id: string
  name: string
  url: string
  status?: string
}

interface FolderPageSwitcherProps {
  folderId: string
  currentProjectId: string
  folderName?: string
}

export function FolderPageSwitcher({ folderId, currentProjectId, folderName }: FolderPageSwitcherProps) {
  const router = useRouter()
  const [pages, setPages] = useState<SiblingProject[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/folders/${folderId}/projects`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setPages(data.projects ?? [])
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [folderId])

  if (loading) {
    return (
      <div className="flex items-center gap-1 text-xs text-neutral-400 flex-shrink-0">
        <Loader2 className="w-3 h-3 animate-spin" />
      </div>
    )
  }

  if (pages.length <= 1) return null

  const current = pages.find((p) => p.id === currentProjectId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs gap-1.5 flex-shrink-0 border-dashed border-neutral-300 dark:border-neutral-700 max-w-40"
          title={folderName ? `Folder: ${folderName}` : 'Folder pages'}
        >
          <FolderOpen className="w-3 h-3 flex-shrink-0 text-purple-500" />
          <span className="truncate">{current?.name ?? 'Pages'}</span>
          <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52 max-w-72">
        {pages.map((page) => (
          <DropdownMenuItem
            key={page.id}
            onClick={() => {
              if (page.id !== currentProjectId) router.push(`/editor/${page.id}`)
            }}
            className={cn(
              'flex items-center gap-2',
              page.id === currentProjectId && 'bg-neutral-100 dark:bg-neutral-800 font-medium'
            )}
          >
            <FileText className="w-3.5 h-3.5 flex-shrink-0 text-neutral-400" />
            <span className="truncate">{page.name}</span>
            {page.id === currentProjectId && (
              <span className="ml-auto text-[10px] text-neutral-400 flex-shrink-0">current</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
