'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trash2 } from 'lucide-react'

interface DeleteConfirmDialogProps {
  title?: string
  description?: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmDialog({
  title = 'Delete Project',
  description = 'This action cannot be undone.',
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  const [typed, setTyped] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white dark:bg-neutral-900 rounded-2xl shadow-xl p-6 max-w-sm w-full border border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/50 mx-auto mb-4">
          <Trash2 className="w-6 h-6 text-red-600 dark:text-red-400" />
        </div>
        <h2 className="text-lg font-bold text-neutral-900 dark:text-white text-center mb-2">
          {title}
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center mb-4">
          {description}
        </p>
        <p className="text-sm text-neutral-700 dark:text-neutral-300 mb-2">
          Type <span className="font-mono font-semibold text-red-600 dark:text-red-400">delete</span> to confirm:
        </p>
        <Input
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="delete"
          className="mb-4"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && typed === 'delete') onConfirm()
            if (e.key === 'Escape') onCancel()
          }}
        />
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="flex-1 gap-2"
            disabled={typed !== 'delete'}
            onClick={onConfirm}
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}
