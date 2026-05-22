'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Send, Loader2, User, Bot, Zap, Upload, ImagePlus, X, Maximize2, Minimize2, Sparkles, History, RotateCcw, Clock } from 'lucide-react'
import type { ChatMessage, ProjectVersion } from '@/types'
import { cn, formatDate } from '@/lib/utils'
import Link from 'next/link'

interface ChatPanelProps {
  projectId: string
  currentHtml: string
  messages: ChatMessage[]
  onMessagesChange: (messages: ChatMessage[]) => void
  onHtmlChange: (html: string) => void
  /** Called with true when a request starts streaming, false when it finishes */
  onGenerating?: (generating: boolean) => void
  /** Called with the final HTML after each successful AI edit to auto-save a version */
  onSaveVersion?: (html: string) => void
  /** URL to append to the chat input (e.g. after an image upload from the toolbar) */
  appendToInput?: string | null
  onAppendConsumed?: () => void
  /** R2 URLs of images uploaded this session, shown as a clickable library */
  uploadedImages?: string[]
  onImageLibraryInsert?: (url: string) => void
  /** Called when a drag-drop upload completes with the new public URL */
  onImageUploaded?: (url: string) => void
  /** When true, chat is locked until Brand Rebuild is completed */
  rebuildRequired?: boolean
  /** When true, a rebuild is currently streaming */
  rebuildInProgress?: boolean
  /** Opens the Brand Rebuild wizard */
  onOpenRebuild?: () => void
  /** Version history */
  versions?: ProjectVersion[]
  onRestoreVersion?: (version: ProjectVersion) => void
  onRefetchVersions?: () => void
}

export function ChatPanel({
  projectId,
  currentHtml,
  messages,
  onMessagesChange,
  onHtmlChange,
  onGenerating,
  onSaveVersion,
  appendToInput,
  onAppendConsumed,
  uploadedImages,
  onImageLibraryInsert,
  onImageUploaded,
  rebuildRequired = false,
  rebuildInProgress = false,
  onOpenRebuild,
  versions,
  onRestoreVersion,
  onRefetchVersions,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea to fit content
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxHeight = isExpanded ? 320 : 160
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px'
  }, [isExpanded])

  useEffect(() => { resizeTextarea() }, [input, isExpanded, resizeTextarea])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploadingImage(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/projects/${projectId}/upload-image`, {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        const data = await res.json() as { url: string }
        setPendingImages((prev) => [...prev, data.url])
        onImageUploaded?.(data.url)
      }
    } catch { /* silent */ } finally {
      setUploadingImage(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    setUploadingImage(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/projects/${projectId}/upload-image`, {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        const data = await res.json() as { url: string }
        setPendingImages((prev) => [...prev, data.url])
        onImageUploaded?.(data.url)
      }
    } catch { /* silent */ } finally {
      setUploadingImage(false)
    }
  }

  // Show upgrade modal immediately if user is already at token limit
  useEffect(() => {
    async function fetchChatStatus() {
      try {
        const res = await fetch(`/api/chat?projectId=${projectId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.isLimited) setShowUpgradeModal(true)
      } catch { /* non-critical */ }
    }
    fetchChatStatus()
  }, [projectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim()) return
    if (loading) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      project_id: projectId,
      user_id: '',
      role: 'user',
      content: input.trim(),
      created_at: new Date().toISOString(),
    }

    const newMessages = [...messages, userMessage]
    onMessagesChange(newMessages)
    setInput('')
    const imagesToSend = [...pendingImages]
    setPendingImages([])
    setLoading(true)
    onGenerating?.(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          message: userMessage.content,
          uploadedImageUrls: imagesToSend,
        }),
      })

      // Handle pre-flight JSON errors (limit reached, auth, etc.)
      if (!res.ok) {
        let data: Record<string, unknown> = {}
        try { data = await res.json() } catch { /* ignore */ }
        if (data.chatLimitReached || data.upgradeRequired) {
          setShowUpgradeModal(true)
          onMessagesChange(messages)
          return
        }
        throw new Error((data.error as string) || `Server error (${res.status})`)
      }

      const { jobId } = await res.json() as { jobId: string }

      // Poll /api/chat/status every 2 seconds until done or error.
      // Transient 5xx errors (502/503/504) are retried — only give up after
      // 3 consecutive failures or a hard 4xx error.
      const aiMessage = await new Promise<{ text: string; tokensUsed: number; estimatedCost: number }>((resolve, reject) => {
        let consecutiveErrors = 0
        const MAX_ERRORS = 5
        const MAX_POLLS = 180 // 6 minutes max
        let pollCount = 0

        const interval = setInterval(async () => {
          pollCount++
          if (pollCount > MAX_POLLS) {
            clearInterval(interval)
            reject(new Error('Generation timed out. Please try again.'))
            return
          }

          try {
            const poll = await fetch(`/api/chat/status?jobId=${jobId}`)

            // Transient server errors — retry instead of immediately failing
            if (poll.status >= 500) {
              consecutiveErrors++
              if (consecutiveErrors >= MAX_ERRORS) {
                clearInterval(interval)
                reject(new Error(`Server error (${poll.status}). Please try again.`))
              }
              return // keep polling
            }

            consecutiveErrors = 0 // reset on any non-5xx response

            if (!poll.ok) {
              clearInterval(interval)
              reject(new Error(`Status check failed (${poll.status})`))
              return
            }

            const data = await poll.json() as {
              status: string
              html?: string
              message?: string
              tokensUsed?: number
              estimatedCost?: number
              error?: string
            }

            if (data.status === 'pending') return // still generating — keep polling

            clearInterval(interval)

            if (data.status === 'error') {
              reject(new Error(data.error || 'Generation failed'))
              return
            }

            // status === 'done'
            if (data.html) {
              onHtmlChange(data.html)
              onSaveVersion?.(data.html)
            }
            resolve({
              text: data.message || 'Done.',
              tokensUsed: data.tokensUsed ?? 0,
              estimatedCost: data.estimatedCost ?? 0,
            })
          } catch (err) {
            consecutiveErrors++
            if (consecutiveErrors >= MAX_ERRORS) {
              clearInterval(interval)
              reject(err)
            }
            // else keep polling — network blip
          }
        }, 2000)
      })

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        project_id: projectId,
        user_id: '',
        role: 'assistant',
        content: aiMessage.text,
        created_at: new Date().toISOString(),
      }
      onMessagesChange([...newMessages, assistantMessage])

    } catch (err) {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        project_id: projectId,
        user_id: '',
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
        created_at: new Date().toISOString(),
      }
      onMessagesChange([...newMessages, errorMessage])
    } finally {
      setLoading(false)
      onGenerating?.(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      <div className="flex flex-col h-full border-t border-neutral-200 dark:border-neutral-800">
        {/* Header */}
        <div className="px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 flex items-center gap-2 flex-shrink-0">
          {showHistory ? (
            <>
              <History className="w-4 h-4 text-neutral-500" />
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">History</span>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => onSaveVersion?.(currentHtml ?? '')} className="h-6 text-xs px-2">
                  Save Version
                </Button>
                <button
                  onClick={() => setShowHistory(false)}
                  className="text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 px-2 py-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  ← Chat
                </button>
              </div>
            </>
          ) : (
            <>
              <Bot className="w-4 h-4 text-neutral-500" />
              <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">AI Chat</span>
              <button
                onClick={() => { setShowHistory(true); onRefetchVersions?.() }}
                className="ml-auto flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 px-2 py-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <History className="w-3.5 h-3.5" />
                History
              </button>
            </>
          )}
        </div>


        {/* Version History panel */}
        {showHistory && (
          <ScrollArea className="flex-1 min-h-0">
            {!versions || versions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-neutral-400 dark:text-neutral-500 text-sm">
                <History className="w-8 h-8 mb-3 opacity-40" />
                <p>No versions saved yet</p>
                <p className="text-xs mt-1">Versions are saved automatically after each AI edit</p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                <div className="flex items-center gap-3 px-4 py-3 bg-neutral-50 dark:bg-neutral-900/50">
                  <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Current</p>
                    <p className="text-xs text-neutral-500">{currentHtml?.length.toLocaleString()} chars</p>
                  </div>
                </div>
                {[...versions].sort((a, b) => b.version_number - a.version_number).map((v) => {
                  const isOriginal = v.label === 'Original Clone'
                  return (
                    <div key={v.id} className={cn('flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 group', isOriginal && 'bg-amber-50/50 dark:bg-amber-950/10')}>
                      {isOriginal
                        ? <Sparkles className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        : <Clock className="w-4 h-4 text-neutral-400 flex-shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{v.label ?? `Version ${v.version_number}`}</p>
                          {isOriginal && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/50 px-1.5 py-0.5 rounded">
                              Clone
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-500">{formatDate(v.created_at)} · {v.html_content.length.toLocaleString()} chars</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => { onRestoreVersion?.(v); setShowHistory(false) }}
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Restore
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        )}

        {/* Messages */}
        {!showHistory && <ScrollArea className="flex-1 min-h-0 p-4">
          {messages.length === 0 ? (
            <div className="text-center text-sm text-neutral-400 dark:text-neutral-500 py-8">
              <Bot className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="font-medium">Ask AI to modify the website</p>
              <p className="text-xs mt-1">e.g. "Change the header color to blue" or "Add a contact form"</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
                >
                  <div
                    className={cn(
                      'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center',
                      msg.role === 'user'
                        ? 'bg-neutral-900 dark:bg-white'
                        : 'bg-neutral-100 dark:bg-neutral-800'
                    )}
                  >
                    {msg.role === 'user' ? (
                      <User className="w-3.5 h-3.5 text-white dark:text-neutral-900" />
                    ) : (
                      <Bot className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                    )}
                  </div>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-xl px-3 py-2 text-sm',
                      msg.role === 'user'
                        ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 rounded-tr-sm'
                        : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-tl-sm'
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                    <Bot className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                  </div>
                  <div className="bg-neutral-100 dark:bg-neutral-800 rounded-xl rounded-tl-sm px-4 py-3">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:0ms]" />
                      <div className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:150ms]" />
                      <div className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>}



        {/* Pending image thumbnails */}
        {pendingImages.length > 0 && (
          <div className="px-4 pt-2 flex gap-2 flex-wrap border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
            {pendingImages.map((url, i) => (
              <div key={i} className="relative w-14 h-14 flex-shrink-0">
                <img src={url} alt={`Attachment ${i + 1}`} className="w-full h-full object-cover rounded border border-neutral-200 dark:border-neutral-700" />
                <button
                  onClick={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-full flex items-center justify-center"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Clone quality notice — shown before first rebuild so users understand what they're seeing */}
        {!showHistory && rebuildRequired && !rebuildInProgress && (
          <div className="mx-3 mt-3 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-0.5">This is a layout blueprint</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
              The clone captures structure and design — not live data. Dynamic sections (product carousels, live inventory) may appear empty. The Brand Rebuild replaces all content with your brand anyway.
            </p>
          </div>
        )}

        {/* Brand Rebuild gate — shown before first rebuild */}
        {!showHistory && rebuildRequired && (
          rebuildInProgress ? (
            <div className="px-4 py-5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 flex flex-col items-center gap-3 text-center">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-purple-400 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              </div>
              <div>
                <p className="text-sm font-semibold text-neutral-900 dark:text-white">Rebuilding your website…</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">This may take a minute. Chat will unlock when done.</p>
              </div>
              <div className="w-full rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 px-3 py-2">
                <p className="text-xs text-purple-700 dark:text-purple-300">Your website is currently being rebuilt</p>
              </div>
            </div>
          ) : (
            <div className="px-4 py-5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 flex flex-col items-center gap-3 text-center">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-purple-400 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-neutral-900 dark:text-white">Brand Rebuild first</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Apply your brand to the site before making edits</p>
              </div>
              <Button
                size="sm"
                className="w-full gap-2 bg-purple-600 hover:bg-purple-500 text-white border-0"
                onClick={onOpenRebuild}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Start Brand Rebuild
              </Button>
            </div>
          )
        )}

        {/* Input area */}
        {!showHistory && !rebuildRequired && (
        <div
          className="px-3 py-3 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 sticky bottom-0"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />

          {isDragging ? (
            <div className="flex items-center justify-center gap-2 text-sm text-blue-500 dark:text-blue-400 py-4 rounded-xl border-2 border-dashed border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30">
              <Upload className="w-4 h-4" />
              Drop image to upload
            </div>
          ) : uploadingImage ? (
            <div className="flex items-center gap-2 text-sm text-neutral-400 px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Uploading image…
            </div>
          ) : (
            <div className={cn(
              'rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 transition-all focus-within:border-neutral-400 dark:focus-within:border-neutral-500',
              isExpanded && 'shadow-lg'
            )}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isAtLimit ? 'Upgrade to continue chatting...' : 'Ask AI to modify the website...'}
                disabled={loading || isAtLimit}
                rows={1}
                className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none disabled:opacity-50 leading-relaxed"
                style={{ minHeight: '44px', maxHeight: isExpanded ? '320px' : '160px' }}
              />
              {/* Toolbar row */}
              <div className="flex items-center justify-between px-2 pb-2 pt-1">
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isAtLimit}
                    title="Upload image"
                  >
                    <ImagePlus className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                    onClick={() => setIsExpanded((v) => !v)}
                    title={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  </Button>
                  <Button
                    size="icon"
                    className="h-7 w-7 bg-neutral-900 hover:bg-neutral-700 dark:bg-white dark:hover:bg-neutral-200 dark:text-neutral-900 rounded-lg"
                    onClick={handleSend}
                    disabled={loading || isAtLimit || !input.trim()}
                  >
                    {loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <p className="text-center text-[10px] text-neutral-400 dark:text-neutral-600 mt-1.5">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
        )}
      </div>

      {/* Upgrade modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowUpgradeModal(false)}
          />
          <div className="relative bg-white dark:bg-neutral-900 rounded-2xl shadow-xl p-6 max-w-sm w-full border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/50 mx-auto mb-4">
              <Zap className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-lg font-bold text-neutral-900 dark:text-white text-center mb-2">
              Token Limit Reached
            </h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center mb-6">
              You&apos;ve used all your AI tokens. Upgrade to Pro for more tokens and unlimited AI modifications.
            </p>
            <div className="flex flex-col gap-2">
              <Link href="/pricing" className="w-full">
                <Button className="w-full gap-2">
                  <Zap className="w-4 h-4" />
                  Upgrade Now
                </Button>
              </Link>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setShowUpgradeModal(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
