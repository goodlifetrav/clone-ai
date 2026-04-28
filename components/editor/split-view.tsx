'use client'

import { useState, useEffect } from 'react'
import { PreviewPane } from './preview-pane'
import { CodeEditor } from './code-editor'
import { ChatPanel } from './chat-panel'
import { VisualEditor } from './visual-editor'
import { TerminalPanel } from './terminal-panel'
import { VersionHistory } from './version-history'
import { ConnectIntegrationModal } from './connect-integration-modal'
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
  Plus,
  LayoutGrid,
  Zap,
  PanelLeftClose,
  PanelLeftOpen,
  Bot,
  Sparkles,
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
type MobileTab = 'preview' | 'chat'

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
  const [mobileTab, setMobileTab] = useState<MobileTab>('preview')
  const [desktopChatVisible, setDesktopChatVisible] = useState(true)
  const [isFreeUser, setIsFreeUser] = useState(false)
  const [integrationModal, setIntegrationModal] = useState<'github' | 'vercel' | 'shopify' | null>(null)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/user')
      .then((r) => r.json())
      .then((data) => {
        if (data.plan === 'free' && !data.is_admin) setIsFreeUser(true)
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

  const handleDeploy = () => {
    setIntegrationModal('vercel')
  }

  const rightTabs: { id: RightTab; label: string; icon: React.ReactNode }[] = [
    { id: 'preview', label: 'Preview', icon: <Eye className="w-3.5 h-3.5" /> },
    { id: 'code', label: 'Code', icon: <Code2 className="w-3.5 h-3.5" /> },
    { id: 'visual', label: 'Visual', icon: <Paintbrush className="w-3.5 h-3.5" /> },
    { id: 'versions', label: 'History', icon: <History className="w-3.5 h-3.5" /> },
    { id: 'terminal', label: 'Terminal', icon: <Terminal className="w-3.5 h-3.5" /> },
  ]

  return (
    <div className="relative flex flex-col h-[100dvh] bg-white dark:bg-neutral-950">
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex-shrink-0 overflow-x-auto">
        {/* Desktop: chat panel toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="hidden sm:flex h-7 w-7 p-0 flex-shrink-0"
          onClick={() => setDesktopChatVisible((v) => !v)}
          title={desktopChatVisible ? 'Hide chat' : 'Show chat'}
        >
          {desktopChatVisible ? (
            <PanelLeftClose className="w-4 h-4" />
          ) : (
            <PanelLeftOpen className="w-4 h-4" />
          )}
        </Button>

        <div className="hidden sm:block h-4 w-px bg-neutral-200 dark:bg-neutral-700 flex-shrink-0" />

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
        <div className="font-medium text-sm truncate max-w-32 sm:max-w-40 text-neutral-700 dark:text-neutral-300 flex-shrink-0">
          {project.name}
        </div>

        {/* Generating indicator */}
        {project.status === 'processing' && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex-shrink-0">
            <Sparkles className="w-3 h-3 text-amber-500 dark:text-amber-400 animate-pulse" />
            <span className="text-xs text-amber-600 dark:text-amber-400 hidden sm:inline">Generating…</span>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Upgrade to Pro — free users only */}
        {isFreeUser && (
          <Link href="/pricing">
            <Button
              size="sm"
              className="h-7 px-3 text-xs gap-1 flex-shrink-0 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white border-0"
            >
              <Zap className="w-3 h-3" />
              <span className="hidden sm:inline">Upgrade to Pro</span>
              <span className="sm:hidden">Pro</span>
            </Button>
          </Link>
        )}

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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-7 px-3 text-xs gap-1 flex-shrink-0">
              <Rocket className="w-3 h-3" />
              <span className="hidden sm:inline">Deploy</span>
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleDeploy}>
              <Rocket className="w-4 h-4 mr-2" />
              Deploy to Vercel
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIntegrationModal('github')}>
              <GitBranch className="w-4 h-4 mr-2" />
              Push to GitHub
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setIntegrationModal('shopify')}>
              <ShoppingBag className="w-4 h-4 mr-2" />
              Deploy to Shopify
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── Mobile tab bar (Preview / Chat) ─────────────────────── */}
      <div className="flex sm:hidden flex-shrink-0 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <button
          onClick={() => setMobileTab('preview')}
          className={cn(
            'flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-colors',
            mobileTab === 'preview'
              ? 'border-neutral-900 dark:border-white text-neutral-900 dark:text-white'
              : 'border-transparent text-neutral-500 dark:text-neutral-400'
          )}
        >
          <Eye className="w-4 h-4" />
          Preview
        </button>
        <button
          onClick={() => setMobileTab('chat')}
          className={cn(
            'flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-colors',
            mobileTab === 'chat'
              ? 'border-neutral-900 dark:border-white text-neutral-900 dark:text-white'
              : 'border-transparent text-neutral-500 dark:text-neutral-400'
          )}
        >
          <Bot className="w-4 h-4" />
          Ask AI
        </button>
      </div>

      {/* ── Main area ────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Chat panel
            Mobile:   visible only when mobileTab === 'chat'
            Desktop:  always shown (unless desktopChatVisible toggled off) */}
        <div
          className={cn(
            'flex-shrink-0 border-r border-neutral-200 dark:border-neutral-800 flex-col overflow-hidden',
            // Mobile visibility
            mobileTab === 'chat' ? 'flex w-full' : 'hidden',
            // Desktop visibility (overrides mobile classes at sm+)
            desktopChatVisible ? 'sm:flex sm:w-[380px]' : 'sm:hidden'
          )}
        >
          <ChatPanel
            projectId={project.id}
            currentHtml={html}
            messages={messages}
            onMessagesChange={onMessagesChange}
            onHtmlChange={onHtmlChange}
          />
        </div>

        {/* Right: Preview / Code / etc.
            Mobile:   visible only when mobileTab === 'preview'
            Desktop:  always shown */}
        <div
          className={cn(
            'flex-1 flex-col overflow-hidden',
            mobileTab === 'preview' ? 'flex' : 'hidden',
            'sm:flex'
          )}
        >
          {/* Right tab bar (desktop only — on mobile you see the full preview) */}
          <div className="hidden sm:flex items-center gap-1 px-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 flex-shrink-0 overflow-x-auto">
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
            {(rightTab === 'preview' || mobileTab === 'preview') && (
              // On mobile always show preview; on desktop only when rightTab === 'preview'
              <div className={cn('h-full', rightTab !== 'preview' ? 'hidden sm:block sm:h-full' : '')}>
                <PreviewPane projectId={project.id} html={displayHtml} className="h-full" />
              </div>
            )}
            {rightTab === 'code' && (
              <div className="hidden sm:block h-full">
                <CodeEditor value={html} onChange={onHtmlChange} className="h-full" />
              </div>
            )}
            {rightTab === 'visual' && (
              <div className="hidden sm:block h-full">
                <VisualEditor onStyleChange={setVisualCss} className="h-full" />
              </div>
            )}
            {rightTab === 'terminal' && (
              <div className="hidden sm:block h-full">
                <TerminalPanel html={html} />
              </div>
            )}
            {rightTab === 'versions' && (
              <div className="hidden sm:block h-full">
                <VersionHistory
                  versions={versions}
                  currentHtml={html}
                  onRestore={onRestoreVersion}
                  onSaveVersion={onSaveVersion}
                  className="h-full"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Integration connect modals */}
      {integrationModal && (
        <ConnectIntegrationModal
          service={integrationModal}
          projectId={project.id}
          onClose={() => setIntegrationModal(null)}
        />
      )}
    </div>
  )
}
