'use client'

import { useState, useEffect } from 'react'
import { PreviewPane } from './preview-pane'
import { CodeEditor } from './code-editor'
import { ChatPanel } from './chat-panel'
import { VisualEditor } from './visual-editor'
import { TerminalPanel } from './terminal-panel'
import { VersionHistory } from './version-history'
import { Button } from '@/components/ui/button'
import {
  Eye,
  Code2,
  Paintbrush,
  Terminal,
  History,
  Download,
  GitFork,
  Rocket,
  GitBranch,
  ShoppingBag,
  ChevronDown,
  Loader2,
  Plus,
  LayoutGrid,
  Zap,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import Link from 'next/link'
import type { Project, ProjectVersion, ChatMessage } from '@/types'
import { useRouter } from 'next/navigation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type RightTab = 'preview' | 'code' | 'visual' | 'terminal' | 'versions'

interface SplitViewProps {
  project: Project
  versions: ProjectVersion[]
  messages: ChatMessage[]
  onHtmlChange: (html: string) => void
  onMessagesChange: (messages: ChatMessage[]) => void
  onSaveVersion: () => void
  onRestoreVersion: (version: ProjectVersion) => void
}

export function SplitView({
  project,
  versions,
  messages,
  onHtmlChange,
  onMessagesChange,
  onSaveVersion,
  onRestoreVersion,
}: SplitViewProps) {
  const [rightTab, setRightTab] = useState<RightTab>('preview')
  const [deploying, setDeploying] = useState(false)
  const [showUpgradeBadge, setShowUpgradeBadge] = useState(false)
  const [chatVisible, setChatVisible] = useState(true)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/user')
      .then((r) => r.json())
      .then((data) => {
        if (data.plan === 'free' && !data.is_admin) setShowUpgradeBadge(true)
      })
      .catch(() => {})
  }, [])

  const html = project.html_content

  const [visualCss, setVisualCss] = useState('')
  const displayHtml = visualCss
    ? html.replace('</head>', `${visualCss}</head>`)
    : html

  const handleDownload = async () => {
    const res = await fetch(`/api/projects/${project.id}/download`)
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.name.replace(/\s+/g, '-')}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleFork = async () => {
    const res = await fetch(`/api/projects/${project.id}/fork`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      router.push(`/editor/${data.project.id}`)
    }
  }

  const handleDeploy = async () => {
    setDeploying(true)
    try {
      const res = await fetch('/api/deploy/vercel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      })
      const data = await res.json()
      if (data.deployUrl) {
        window.open(data.deployUrl, '_blank')
      }
    } catch {
      alert('Deploy failed. Check Vercel integration.')
    } finally {
      setDeploying(false)
    }
  }

  const rightTabs: { id: RightTab; label: string; icon: React.ReactNode }[] = [
    { id: 'preview', label: 'Preview', icon: <Eye className="w-3.5 h-3.5" /> },
    { id: 'code', label: 'Code', icon: <Code2 className="w-3.5 h-3.5" /> },
    { id: 'visual', label: 'Visual', icon: <Paintbrush className="w-3.5 h-3.5" /> },
    { id: 'versions', label: 'History', icon: <History className="w-3.5 h-3.5" /> },
    { id: 'terminal', label: 'Terminal', icon: <Terminal className="w-3.5 h-3.5" /> },
  ]

  return (
    <div className="relative flex flex-col h-screen bg-white dark:bg-neutral-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex-shrink-0 overflow-x-auto">
        {/* Chat toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 flex-shrink-0"
          onClick={() => setChatVisible((v) => !v)}
          title={chatVisible ? 'Hide chat' : 'Show chat'}
        >
          {chatVisible ? (
            <PanelLeftClose className="w-4 h-4" />
          ) : (
            <PanelLeftOpen className="w-4 h-4" />
          )}
        </Button>

        <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700 flex-shrink-0" />

        {/* Navigation */}
        <Link href="/">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 flex-shrink-0">
            <Plus className="w-3 h-3" />
            <span className="hidden sm:inline">New Clone</span>
          </Button>
        </Link>

        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 flex-shrink-0">
            <LayoutGrid className="w-3 h-3" />
            <span className="hidden sm:inline">Projects</span>
          </Button>
        </Link>

        <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700 flex-shrink-0" />

        {/* Project name */}
        <div className="font-medium text-sm truncate max-w-40 text-neutral-700 dark:text-neutral-300 flex-shrink-0">
          {project.name}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Actions */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1 flex-shrink-0"
          onClick={handleFork}
        >
          <GitFork className="w-3 h-3" />
          <span className="hidden sm:inline">Fork</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1 flex-shrink-0"
          onClick={handleDownload}
        >
          <Download className="w-3 h-3" />
          <span className="hidden sm:inline">Download</span>
        </Button>

        {showUpgradeBadge && (
          <Link href="/pricing">
            <Button
              size="sm"
              className="h-7 px-3 text-xs gap-1 flex-shrink-0 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white border-0"
            >
              <Zap className="w-3 h-3" />
              Upgrade
            </Button>
          </Link>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-7 px-3 text-xs gap-1 flex-shrink-0" disabled={deploying}>
              {deploying ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Rocket className="w-3 h-3" />
              )}
              <span className="hidden sm:inline">Deploy</span>
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleDeploy}>
              <Rocket className="w-4 h-4 mr-2" />
              Deploy to Vercel
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => alert('Connect GitHub in settings to push to a repo')}
            >
              <GitBranch className="w-4 h-4 mr-2" />
              Push to GitHub
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => alert('Connect Shopify in settings to deploy')}
            >
              <ShoppingBag className="w-4 h-4 mr-2" />
              Deploy to Shopify
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chat panel */}
        {chatVisible && (
          <div className="w-full sm:w-[380px] flex-shrink-0 border-r border-neutral-200 dark:border-neutral-800 flex flex-col overflow-hidden">
            <ChatPanel
              projectId={project.id}
              currentHtml={html}
              messages={messages}
              onMessagesChange={onMessagesChange}
              onHtmlChange={onHtmlChange}
            />
          </div>
        )}

        {/* Right: Preview/Code/etc */}
        <div
          className={cn(
            'flex-1 flex flex-col overflow-hidden',
            chatVisible ? 'hidden sm:flex' : 'flex'
          )}
        >
          {/* Right tab bar */}
          <div className="flex items-center gap-1 px-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 flex-shrink-0 overflow-x-auto">
            {rightTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setRightTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors flex-shrink-0',
                  rightTab === tab.id
                    ? 'border-neutral-900 dark:border-white text-neutral-900 dark:text-white'
                    : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Right content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === 'preview' && (
              <PreviewPane projectId={project.id} html={displayHtml} className="h-full" />
            )}
            {rightTab === 'code' && (
              <CodeEditor value={html} onChange={onHtmlChange} className="h-full" />
            )}
            {rightTab === 'visual' && (
              <VisualEditor onStyleChange={setVisualCss} className="h-full" />
            )}
            {rightTab === 'terminal' && <TerminalPanel html={html} />}
            {rightTab === 'versions' && (
              <VersionHistory
                versions={versions}
                currentHtml={html}
                onRestore={onRestoreVersion}
                onSaveVersion={onSaveVersion}
                className="h-full"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
