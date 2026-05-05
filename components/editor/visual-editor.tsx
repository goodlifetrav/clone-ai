'use client'

import { Button } from '@/components/ui/button'
import { Wand2 } from 'lucide-react'

interface VisualEditorProps {
  onOpenRebuild: () => void
  className?: string
}

export function VisualEditor({ onOpenRebuild, className = '' }: VisualEditorProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-4 p-8 text-center ${className}`}>
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-600 to-purple-400 flex items-center justify-center">
        <Wand2 className="w-6 h-6 text-white" />
      </div>
      <div className="space-y-1.5">
        <h3 className="font-semibold text-neutral-900 dark:text-white">Rebuild with Your Brand</h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-xs">
          Direct visual editing isn&apos;t available for cloned sites. Use AI Brand Rebuild to
          instantly redesign this page with your colors, copy, and logo.
        </p>
      </div>
      <Button
        onClick={onOpenRebuild}
        className="gap-2 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white border-0"
      >
        <Wand2 className="w-4 h-4" />
        Start Brand Rebuild
      </Button>
    </div>
  )
}
