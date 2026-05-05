'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Save, Check } from 'lucide-react'

interface VisualEditorProps {
  html: string
  onSave: (newHtml: string) => void
  projectId: string
  className?: string
}

export function VisualEditor({ html, onSave, className = '' }: VisualEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const targetImgRef = useRef<HTMLImageElement | null>(null)
  const [saved, setSaved] = useState(false)

  // Extract only body content — avoids html/head nesting issues in a div
  const bodyContent = useMemo(() => {
    const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    return m ? m[1] : html
  }, [html])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Make text elements contenteditable
    container
      .querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, span, a, li, button')
      .forEach((el) => {
        el.contentEditable = 'true'
        el.dataset.editable = 'true'
      })

    // Image click → file picker to replace
    const handleImgClick = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      targetImgRef.current = e.currentTarget as HTMLImageElement
      fileInputRef.current?.click()
    }

    const imgs = container.querySelectorAll<HTMLImageElement>('img')
    imgs.forEach((img) => {
      img.style.cursor = 'pointer'
      img.addEventListener('click', handleImgClick)
    })

    return () => {
      imgs.forEach((img) => img.removeEventListener('click', handleImgClick))
    }
  }, [bodyContent])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !targetImgRef.current) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      if (targetImgRef.current && ev.target?.result) {
        targetImgRef.current.src = ev.target.result as string
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleSave = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    // Clone and strip editor-only attributes
    const clone = container.cloneNode(true) as HTMLElement
    clone.querySelectorAll('[contenteditable]').forEach((el) => {
      el.removeAttribute('contenteditable')
      ;(el as HTMLElement).removeAttribute('data-editable')
    })

    const editedBody = clone.innerHTML

    // Reconstruct full HTML by replacing the body contents
    const bodyTagMatch = html.match(/<body([^>]*)>/i)
    const bodyAttrs = bodyTagMatch ? bodyTagMatch[1] : ''
    const newHtml = html.match(/<body[^>]*>/i)
      ? html.replace(/<body[^>]*>[\s\S]*?<\/body>/i, `<body${bodyAttrs}>${editedBody}</body>`)
      : editedBody

    onSave(newHtml)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }, [html, onSave])

  return (
    <div className={`relative flex flex-col overflow-hidden ${className}`}>
      {/* Hover/focus outline styles for editable elements */}
      <style>{`
        [data-editable="true"] { outline: none; }
        [data-editable="true"]:hover { outline: 2px solid #3b82f6 !important; outline-offset: 1px; cursor: text; }
        [data-editable="true"]:focus { outline: 2px solid #2563eb !important; outline-offset: 1px; }
      `}</style>

      {/* Rendered HTML — editable inline */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        dangerouslySetInnerHTML={{ __html: bodyContent }}
      />

      {/* Floating save button */}
      <div className="absolute bottom-4 right-4 flex items-center gap-2 z-50">
        {saved && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-xs font-medium shadow-sm border border-green-200 dark:border-green-700">
            <Check className="w-3 h-3" />
            Changes saved
          </div>
        )}
        <Button size="sm" onClick={handleSave} className="shadow-lg">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          Save Changes
        </Button>
      </div>

      {/* Hidden file input for image replacement */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}
