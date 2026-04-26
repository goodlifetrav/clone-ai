'use client'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { History, RotateCcw, Clock } from 'lucide-react'
import type { ProjectVersion } from '@/types'
import { formatDate } from '@/lib/utils'

interface VersionHistoryProps {
  versions: ProjectVersion[]
  currentHtml: string
  onRestore: (version: ProjectVersion) => void
  onSaveVersion: () => void
  className?: string
}

export function VersionHistory({
  versions,
  currentHtml,
  onRestore,
  onSaveVersion,
  className = '',
}: VersionHistoryProps) {
  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-neutral-500" />
          <span className="text-sm font-medium">Version History</span>
        </div>
        <Button size="sm" variant="outline" onClick={onSaveVersion} className="h-7 text-xs">
          Save Version
        </Button>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        {versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-neutral-400 dark:text-neutral-500 text-sm">
            <History className="w-8 h-8 mb-3 opacity-40" />
            <p>No versions saved yet</p>
            <p className="text-xs mt-1">Click "Save Version" to create a snapshot</p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {/* Current (unsaved) state */}
            <div className="flex items-center gap-3 px-4 py-3 bg-neutral-50 dark:bg-neutral-900/50">
              <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Current (unsaved)</p>
                <p className="text-xs text-neutral-500">{currentHtml.length.toLocaleString()} chars</p>
              </div>
            </div>

            {versions
              .sort((a, b) => b.version_number - a.version_number)
              .map((version) => (
                <div
                  key={version.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 group"
                >
                  <Clock className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Version {version.version_number}</p>
                    <p className="text-xs text-neutral-500">
                      {formatDate(version.created_at)} • {version.html_content.length.toLocaleString()} chars
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onRestore(version)}
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Restore
                  </Button>
                </div>
              ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
