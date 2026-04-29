'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Send, ImagePlus, X, Loader2, User, Bot, Zap } from 'lucide-react'
import type { ChatMessage } from '@/types'
import { cn } from '@/lib/utils'
import Link from 'next/link'

interface ChatPanelProps {
  projectId: string
  currentHtml: string
  messages: ChatMessage[]
  onMessagesChange: (messages: ChatMessage[]) => void
  onHtmlChange: (html: string) => void
  /** Called with true when a request starts streaming, false when it finishes */
  onGenerating?: (generating: boolean) => void
  /** URL to append to the chat input (e.g. after an image upload from the toolbar) */
  appendToInput?: string | null
  onAppendConsumed?: () => void
  /** R2 URLs of images uploaded this session, shown as a clickable library */
  uploadedImages?: string[]
  onImageLibraryInsert?: (url: string) => void
}

export function ChatPanel({
  projectId,
  currentHtml,
  messages,
  onMessagesChange,
  onHtmlChange,
  onGenerating,
  appendToInput,
  onAppendConsumed,
  uploadedImages,
  onImageLibraryInsert,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [image, setImage] = useState<{ base64: string; mimeType: string; preview: string } | null>(null)
  const [messagesUsed, setMessagesUsed] = useState<number | null>(null)
  const [chatLimit, setChatLimit] = useState<number | null>(null)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Fetch initial message count and limit on mount
  useEffect(() => {
    async function fetchChatStatus() {
      try {
        const res = await fetch(`/api/chat?projectId=${projectId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.isLimited) {
          setMessagesUsed(data.messagesUsed)
          setChatLimit(data.limit)
        }
      } catch {
        // silently fail — count display is non-critical
      }
    }
    fetchChatStatus()
  }, [projectId])

  // When the toolbar uploads an image, append its URL to the chat input
  useEffect(() => {
    if (appendToInput) {
      setInput((prev) => (prev ? `${prev} ${appendToInput}` : appendToInput))
      onAppendConsumed?.()
    }
  }, [appendToInput, onAppendConsumed])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const isAtLimit = chatLimit !== null && messagesUsed !== null && messagesUsed >= chatLimit

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = ev.target?.result as string
      const base64 = result.split(',')[1]
      setImage({ base64, mimeType: file.type, preview: result })
    }
    reader.readAsDataURL(file)
  }

  const handleSend = async () => {
    if (!input.trim() && !image) return
    if (loading) return

    // Block at limit before hitting the API
    if (isAtLimit) {
      setShowUpgradeModal(true)
      return
    }

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
    const sentImage = image
    setImage(null)
    setLoading(true)
    onGenerating?.(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          message: userMessage.content,
          currentHtml,
          imageBase64: sentImage?.base64,
          imageMimeType: sentImage?.mimeType,
        }),
      })

      // Pre-stream JSON errors (limit reached etc.) come back as non-SSE JSON
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        const data = await res.json()
        if (data.chatLimitReached) {
          setShowUpgradeModal(true)
          onMessagesChange(messages)
          return
        }
        throw new Error(data.error || 'Chat failed')
      }

      // Read the SSE stream
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let aiMessage = ''
      let newMessagesUsed: number | null = null

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const text = line.slice(6).trim()
          if (!text) continue

          let event: Record<string, unknown>
          try { event = JSON.parse(text) } catch { continue }

          if (event.htmlChunk) {
            // Stream partial HTML into the editor in real time
            onHtmlChange(event.htmlChunk as string)
          }

          if (event.done) {
            aiMessage = event.message as string
            newMessagesUsed = event.messagesUsed as number
            // Final HTML (fully parsed and cleaned) replaces the partial
            if (event.html) onHtmlChange(event.html as string)
            break outer
          }

          if (event.chatLimitReached) {
            setShowUpgradeModal(true)
            onMessagesChange(messages)
            return
          }

          if (event.error) {
            throw new Error(event.error as string)
          }
        }
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        project_id: projectId,
        user_id: '',
        role: 'assistant',
        content: aiMessage || 'Done.',
        created_at: new Date().toISOString(),
      }
      onMessagesChange([...newMessages, assistantMessage])

      if (newMessagesUsed !== null && chatLimit !== null) {
        setMessagesUsed(newMessagesUsed)
      }
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
        <div className="px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 flex items-center gap-2">
          <Bot className="w-4 h-4 text-neutral-500" />
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">AI Chat</span>
          {chatLimit !== null && messagesUsed !== null ? (
            <span
              className={cn(
                'text-xs ml-auto',
                isAtLimit
                  ? 'text-red-500 dark:text-red-400 font-medium'
                  : messagesUsed >= chatLimit - 1
                  ? 'text-amber-500 dark:text-amber-400'
                  : 'text-neutral-400'
              )}
            >
              {messagesUsed} of {chatLimit} free messages used
            </span>
          ) : (
            <span className="text-xs text-neutral-400 ml-auto">Press Enter to send</span>
          )}
        </div>

        {/* Uploaded image library */}
        {uploadedImages && uploadedImages.length > 0 && (
          <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60">
            <p className="text-xs text-neutral-400 mb-1.5">Uploaded images — click to insert URL:</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {uploadedImages.map((url, i) => (
                <button
                  key={i}
                  onClick={() => onImageLibraryInsert?.(url)}
                  className="flex-shrink-0 w-14 h-14 rounded border border-neutral-200 dark:border-neutral-700 overflow-hidden hover:border-neutral-500 dark:hover:border-neutral-400 transition-colors"
                  title={`Click to insert: ${url}`}
                >
                  <img src={url} alt={`Upload ${i + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <ScrollArea className="flex-1 min-h-0 p-4">
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
        </ScrollArea>

        {/* Image preview */}
        {image && (
          <div className="px-4 py-2 border-t border-neutral-200 dark:border-neutral-800">
            <div className="relative inline-block">
              <img src={image.preview} alt="Upload" className="h-16 w-auto rounded border" />
              <button
                onClick={() => setImage(null)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-xs"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          </div>
        )}

        {/* Limit reached banner */}
        {isAtLimit && (
          <div className="px-4 py-2 border-t border-neutral-200 dark:border-neutral-800 bg-amber-50 dark:bg-amber-950/30 flex items-center justify-between gap-3">
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Free chat limit reached.
            </p>
            <Link href="/pricing">
              <Button size="sm" className="h-6 text-xs px-2 gap-1">
                <Zap className="w-3 h-3" />
                Upgrade
              </Button>
            </Link>
          </div>
        )}

        {/* Input — sticky on mobile so it's always visible above the keyboard */}
        <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 flex gap-2 sticky bottom-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 flex-shrink-0"
            onClick={() => fileInputRef.current?.click()}
            title="Upload image"
            disabled={isAtLimit}
          >
            <ImagePlus className="w-4 h-4" />
          </Button>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isAtLimit ? 'Upgrade to continue chatting...' : 'Ask AI to modify the website...'}
            disabled={loading || isAtLimit}
            className="flex-1"
          />
          <Button
            size="icon"
            className="h-9 w-9 flex-shrink-0"
            onClick={handleSend}
            disabled={loading || isAtLimit || (!input.trim() && !image)}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
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
              Free Edits Used
            </h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center mb-6">
              You&apos;ve used your 5 free edits. Upgrade to Pro for unlimited AI modifications.
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
