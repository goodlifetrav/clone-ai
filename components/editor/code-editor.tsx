'use client'

import { useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useTheme } from '@/hooks/use-theme'
import { Loader2 } from 'lucide-react'
import type { editor as MonacoEditorNS } from 'monaco-editor'

const MonacoEditor = dynamic(
  () => import('@monaco-editor/react').then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-neutral-950">
        <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
      </div>
    ),
  }
)

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  className?: string
  /** When true the editor auto-scrolls to the bottom as new content streams in */
  isStreaming?: boolean
}

export function CodeEditor({ value, onChange, className = '', isStreaming = false }: CodeEditorProps) {
  const { isDark } = useTheme()
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null)

  // Auto-scroll to the last line whenever content grows during streaming
  useEffect(() => {
    if (!isStreaming || !editorRef.current) return
    const model = editorRef.current.getModel()
    if (!model) return
    const lastLine = model.getLineCount()
    editorRef.current.revealLine(lastLine)
  }, [value, isStreaming])

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-xs text-neutral-500 dark:text-neutral-400">
        <span className="font-medium">index.html</span>
        {isStreaming && (
          <span className="flex items-center gap-1 text-amber-500 dark:text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            streaming
          </span>
        )}
        <span className="ml-auto">{value.length.toLocaleString()} chars</span>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1">
        <MonacoEditor
          height="100%"
          language="html"
          theme={isDark ? 'vs-dark' : 'vs-light'}
          value={value}
          onChange={(val) => onChange(val || '')}
          onMount={(editor) => {
            editorRef.current = editor
          }}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineHeight: 20,
            padding: { top: 12, bottom: 12 },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            tabSize: 2,
            insertSpaces: true,
            formatOnPaste: true,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            renderWhitespace: 'selection',
            bracketPairColorization: { enabled: true },
            // Disable editing while streaming so user doesn't accidentally type
            readOnly: isStreaming,
          }}
        />
      </div>
    </div>
  )
}
