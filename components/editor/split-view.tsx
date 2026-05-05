'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { PreviewPane } from './preview-pane'
import { CodeEditor } from './code-editor'
import { ChatPanel } from './chat-panel'
import { VisualEditor } from './visual-editor'
import { BrandWizard } from './brand-wizard'
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
  HelpCircle,
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
  MoreHorizontal,
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
type MobileTab = 'preview' | 'chat' | 'code' | 'more'

interface SplitViewProps {
  project: Project
  versions: ProjectVersion[]
  messages: ChatMessage[]
  /** True while the clone SSE stream is actively pushing HTML chunks */
  isStreaming?: boolean
  onHtmlChange: (html: string) => void
  onMessagesChange: (messages: ChatMessage[]) => void
  onSaveVersion: (html?: string) => void
  onRestoreVersion: (version: ProjectVersion) => void
}

export function SplitView({
  project,
  versions,
  messages,
  isStreaming: isStreamingProp = false,
  onHtmlChange,
  onMessagesChange,
  onSaveVersion,
  onRestoreVersion,
}: SplitViewProps) {
  const [rightTab, setRightTab] = useState<RightTab>('preview')
  const [mobileTab, setMobileTab] = useState<MobileTab>('preview')
  const [desktopChatVisible, setDesktopChatVisible] = useState(true)
  const [isFreeUser, setIsFreeUser] = useState(false)
  const [userPlan, setUserPlan] = useState<string>('free')
  const [integrationModal, setIntegrationModal] = useState<'github' | 'vercel' | 'shopify' | null>(null)
  // True while the clone SSE stream is active OR the AI chat is streaming
  // isStreamingProp comes from use-project's real-time stream subscription;
  // isGenerating covers the chat streaming case managed locally.
  const [chatGenerating, setChatGenerating] = useState(false)
  const [showBrandWizard, setShowBrandWizard] = useState(false)
  const [showMoreSheet, setShowMoreSheet] = useState(false)
  const [moreContent, setMoreContent] = useState<'visual' | 'history' | null>(null)
  const rebuildHtmlRef = useRef('')
  const isGenerating = isStreamingProp || chatGenerating
  const prevStatusRef = useRef(project.status)
  const router = useRouter()

  // Image upload state
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const [chatInputAppend, setChatInputAppend] = useState<string | null>(null)

  // Auto-switch tabs based on project.status transitions (clone streaming)
  useEffect(() => {
    const prev = prevStatusRef.current
    const curr = project.status
    if ((curr === 'processing' || curr === 'pending') && prev !== 'processing' && prev !== 'pending') {
      setRightTab('code')
      setMobileTab('preview')
    }
    if (curr === 'complete' && (prev === 'processing' || prev === 'pending')) {
      setRightTab('preview')
    }
    prevStatusRef.current = curr
  }, [project.status])

  // Also switch tabs immediately when the stream activates/deactivates
  useEffect(() => {
    if (isStreamingProp) {
      setRightTab('code')
      setMobileTab('preview')
    } else if (!chatGenerating && (prevStatusRef.current === 'complete' || prevStatusRef.current === 'processing')) {
      // Stream just ended and we're complete — go to preview
      setRightTab('preview')
    }
  }, [isStreamingProp, chatGenerating])

  // Called by ChatPanel while it's streaming an AI response
  const handleChatGenerating = useCallback((generating: boolean) => {
    setChatGenerating(generating)
    if (generating) {
      setRightTab('code')
      setMobileTab('preview')
    } else {
      setRightTab('preview')
    }
  }, [])

  useEffect(() => {
    fetch('/api/user')
      .then((r) => r.json())
      .then((data) => {
        if (data.plan === 'free' && !data.is_admin) setIsFreeUser(true)
        if (data.plan) setUserPlan(data.is_admin ? 'admin' : data.plan)
      })
      .catch(() => {})
  }, [])

  const html = project.html_content

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

        {/* Generating indicator — shown during initial clone AND AI chat streaming */}
        {isGenerating && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex-shrink-0">
            <Sparkles className="w-3 h-3 text-amber-500 dark:text-amber-400 animate-pulse" />
            <span className="text-xs text-amber-600 dark:text-amber-400 hidden sm:inline">
              {project.status === 'processing' ? 'Generating…' : 'Writing…'}
            </span>
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

        <a href="mailto:support@igualai.com?subject=IgualAI Support Request">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1 flex-shrink-0"
            title="Contact Support"
          >
            <HelpCircle className="w-3 h-3" />
            <span className="hidden sm:inline">Help</span>
          </Button>
        </a>

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

      {/* ── Main area ────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden pb-16 sm:pb-0">

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
            onGenerating={handleChatGenerating}
            onSaveVersion={onSaveVersion}
            appendToInput={chatInputAppend}
            onAppendConsumed={() => setChatInputAppend(null)}
            uploadedImages={uploadedImages}
            onImageLibraryInsert={(url) => setChatInputAppend(url)}
            onImageUploaded={(url) => {
              setUploadedImages((prev) => [...prev, url])
              setChatInputAppend(url)
            }}
          />
        </div>

        {/* Right: Preview / Code / etc.
            Mobile:   visible only when mobileTab === 'preview'
            Desktop:  always shown */}
        <div
          className={cn(
            'flex-1 flex-col overflow-hidden',
            mobileTab !== 'chat' ? 'flex' : 'hidden',
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

          {/* Right content — two stacked absolute layers:
              1. Mobile layer (sm:hidden): always shows PreviewPane, swaps to
                 CodeEditor while generating so the user sees live code.
              2. Desktop layer (hidden sm:block): pure JS conditionals pick
                 the active tab — no responsive-class visibility tricks. */}
          <div className="flex-1 min-h-0 relative overflow-hidden">

            {/* ── Mobile layer ─────────────────────────────────────────── */}
            <div className="absolute inset-0 sm:hidden">
              {mobileTab === 'preview' && (
                isGenerating
                  ? <CodeEditor value={html} onChange={onHtmlChange} className="h-full" isStreaming={isGenerating} />
                  : <PreviewPane projectId={project.id} html={html} className="h-full" />
              )}
              {mobileTab === 'code' && (
                <CodeEditor value={html} onChange={onHtmlChange} className="h-full" isStreaming={isGenerating} />
              )}
              {mobileTab === 'more' && moreContent === 'visual' && (
                <VisualEditor onOpenRebuild={() => setShowBrandWizard(true)} className="h-full" />
              )}
              {mobileTab === 'more' && moreContent === 'history' && (
                <VersionHistory
                  versions={versions}
                  currentHtml={html}
                  onRestore={onRestoreVersion}
                  onSaveVersion={onSaveVersion}
                  className="h-full"
                />
              )}
              {mobileTab === 'more' && moreContent === null && (
                <PreviewPane projectId={project.id} html={html} className="h-full" />
              )}
            </div>

            {/* ── Desktop layer ────────────────────────────────────────── */}
            <div className="absolute inset-0 hidden sm:block">
              {rightTab === 'preview' && (
                <PreviewPane projectId={project.id} html={html} className="h-full" />
              )}
              {rightTab === 'code' && (
                <CodeEditor value={html} onChange={onHtmlChange} className="h-full" isStreaming={isGenerating} />
              )}
              {rightTab === 'visual' && (
                <VisualEditor
                  onOpenRebuild={() => setShowBrandWizard(true)}
                  className="h-full"
                />
              )}
              {rightTab === 'terminal' && (
                <TerminalPanel html={html} />
              )}
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

      {/* ── Mobile bottom nav bar ────────────────────────────────── */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        {[
          { id: 'preview' as MobileTab, label: 'Preview', icon: <Eye className="w-5 h-5" /> },
          { id: 'chat' as MobileTab, label: 'Ask AI', icon: <Bot className="w-5 h-5" /> },
          { id: 'code' as MobileTab, label: 'Code', icon: <Code2 className="w-5 h-5" /> },
          { id: 'more' as MobileTab, label: 'More', icon: <MoreHorizontal className="w-5 h-5" /> },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              if (tab.id === 'more') {
                setShowMoreSheet(true)
                setMobileTab('more')
              } else {
                setMobileTab(tab.id)
                setShowMoreSheet(false)
              }
            }}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
              mobileTab === tab.id
                ? 'text-purple-600 dark:text-purple-400'
                : 'text-neutral-500 dark:text-neutral-400'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── More slide-up sheet ───────────────────────────────────── */}
      {showMoreSheet && (
        <div className="sm:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowMoreSheet(false)}
          />
          {/* Sheet */}
          <div className="relative bg-white dark:bg-neutral-900 rounded-t-2xl border-t border-neutral-200 dark:border-neutral-800 pb-safe pb-8">
            <div className="w-10 h-1 bg-neutral-300 dark:bg-neutral-600 rounded-full mx-auto mt-3 mb-4" />
            <div className="px-4 space-y-1">
              <button
                onClick={() => {
                  setMoreContent('visual')
                  setRightTab('visual')
                  setShowMoreSheet(false)
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-neutral-900 dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <Paintbrush className="w-5 h-5 text-purple-500" />
                Visual
              </button>
              <button
                onClick={() => {
                  setMoreContent('history')
                  setRightTab('versions')
                  setShowMoreSheet(false)
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-neutral-900 dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <History className="w-5 h-5 text-purple-500" />
                History
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Brand Rebuild wizard */}
      {showBrandWizard && (
        <BrandWizard
          projectId={project.id}
          onClose={() => setShowBrandWizard(false)}
          onRebuildStart={() => {
            rebuildHtmlRef.current = ''
            setRightTab('code')
            setChatGenerating(true)
          }}
          onHtmlChunk={(chunk) => {
            rebuildHtmlRef.current += chunk
            onHtmlChange(rebuildHtmlRef.current)
          }}
          onRebuildComplete={(finalHtml) => {
            onHtmlChange(finalHtml)
            setChatGenerating(false)
            setRightTab('preview')
            onSaveVersion(finalHtml)
          }}
          onRebuildError={() => {
            setChatGenerating(false)
          }}
        />
      )}

      {/* Integration connect modals */}
      {integrationModal && (
        <ConnectIntegrationModal
          service={integrationModal}
          projectId={project.id}
          userPlan={userPlan}
          onClose={() => setIntegrationModal(null)}
        />
      )}
    </div>
  )
}
