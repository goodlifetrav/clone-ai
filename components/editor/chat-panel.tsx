'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Send, ImagePlus, X, Loader2, User, Bot } from 'lucide-react'
import type { ChatMessage } from '@/types'
import { cn } from '@/lib/utils'

interface ChatPanelProps {
  projectId: string
  currentHtml: string
  messages: ChatMessage[]
  onMessagesChange: (messages: ChatMessage[]) => void
  onHtmlChange: (html: string) => void
}

export function ChatPanel({
  projectId,
  currentHtml,
  messages,
  onMessagesChange,
  onHtmlChange,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [image, setImage] = useState<{ base64: string; mimeType: string; preview: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = ev.target?.result as string
      const base64 = result.split(',')[1]
      setImage({
        base64,
        mimeType: file.type,
        preview: result,
      })
    }
    reader.readAsDataURL(file)
  }

  const handleSend = async () => {
    if (!input.trim() && !image) return
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
    const sentImage = image
    setImage(null)
    setLoading(true)

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

      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Chat failed')

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        project_id: projectId,
        user_id: '',
        role: 'assistant',
        content: data.message,
        created_at: new Date().toISOString(),
      }

      onMessagesChange([...newMessages, assistantMessage])

      if (data.html) {
        onHtmlChange(data.html)
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
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full border-t border-neutral-200 dark:border-neutral-800">
      {/* Header */}
      <div className="px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 flex items-center gap-2">
        <Bot className="w-4 h-4 text-neutral-500" />
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">AI Chat</span>
        <span className="text-xs text-neutral-400 ml-auto">Press Enter to send</span>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
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

      {/* Input */}
      <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 flex gap-2">
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
        >
          <ImagePlus className="w-4 h-4" />
        </Button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask AI to modify the website..."
          disabled={loading}
          className="flex-1"
        />
        <Button
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={handleSend}
          disabled={loading || (!input.trim() && !image)}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
