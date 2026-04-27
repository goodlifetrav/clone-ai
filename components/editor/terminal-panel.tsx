'use client'

import { useState, useRef, useEffect } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Terminal } from 'lucide-react'

interface TerminalLine {
  id: string
  type: 'command' | 'output' | 'error' | 'info'
  text: string
  timestamp: string
}

const SIMULATED_COMMANDS: Record<string, string[]> = {
  help: [
    'Available commands:',
    '  help         Show this help',
    '  ls           List files',
    '  pwd          Show current directory',
    '  cat index.html   Show HTML content',
    '  validate     Validate HTML',
    '  format       Format HTML',
    '  clear        Clear terminal',
  ],
  ls: ['index.html', 'assets/', 'images/'],
  pwd: ['/project'],
  validate: ['[OK] HTML structure is valid', '[OK] No broken tags detected', '[OK] 0 errors found'],
  format: ['[OK] HTML formatted successfully'],
}

export function TerminalPanel({ html }: { html: string }) {
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      id: '1',
      type: 'info',
      text: 'IgualAI Terminal v1.0 — type "help" to see available commands',
      timestamp: new Date().toISOString(),
    },
  ])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  const addLine = (type: TerminalLine['type'], text: string) => {
    setLines((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type, text, timestamp: new Date().toISOString() },
    ])
  }

  const handleCommand = (cmd: string) => {
    const trimmed = cmd.trim()
    if (!trimmed) return

    addLine('command', `$ ${trimmed}`)
    setHistory((prev) => [trimmed, ...prev])
    setHistoryIndex(-1)

    if (trimmed === 'clear') {
      setLines([])
      return
    }

    if (trimmed === 'cat index.html') {
      addLine('output', html.slice(0, 500) + (html.length > 500 ? '\n...[truncated]' : ''))
      return
    }

    if (trimmed.startsWith('echo ')) {
      addLine('output', trimmed.slice(5).replace(/"/g, ''))
      return
    }

    const base = trimmed.split(' ')[0]
    const outputs = SIMULATED_COMMANDS[base]

    if (outputs) {
      outputs.forEach((line) => addLine('output', line))
    } else {
      addLine('error', `command not found: ${base}`)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCommand(input)
      setInput('')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const newIndex = Math.min(historyIndex + 1, history.length - 1)
      setHistoryIndex(newIndex)
      setInput(history[newIndex] || '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const newIndex = Math.max(historyIndex - 1, -1)
      setHistoryIndex(newIndex)
      setInput(newIndex === -1 ? '' : history[newIndex] || '')
    }
  }

  const getLineColor = (type: TerminalLine['type']) => {
    switch (type) {
      case 'command': return 'text-green-400'
      case 'error': return 'text-red-400'
      case 'info': return 'text-blue-400'
      default: return 'text-neutral-300'
    }
  }

  return (
    <div className="flex flex-col h-full bg-neutral-950 font-mono text-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-800 bg-neutral-900">
        <Terminal className="w-4 h-4 text-green-400" />
        <span className="text-xs text-neutral-400">Terminal</span>
      </div>

      {/* Output */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-0.5">
          {lines.map((line) => (
            <div key={line.id} className={`leading-5 whitespace-pre-wrap break-all ${getLineColor(line.type)}`}>
              {line.text}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="flex items-center gap-2 px-4 py-2 border-t border-neutral-800">
        <span className="text-green-400">$</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent text-neutral-100 outline-none caret-green-400"
          placeholder="type a command..."
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  )
}
