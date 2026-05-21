'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { PreviewPane } from './preview-pane'
import { CodeEditor } from './code-editor'
import { ChatPanel } from './chat-panel'
import { VisualEditor } from './visual-editor'
import { BrandWizard } from './brand-wizard'
import { VersionHistory } from './version-history'
import { ConnectIntegrationModal } from './connect-integration-modal'
import { FolderPageSwitcher } from './folder-page-switcher'
import { Button } from '@/components/ui/button'
import {
  Eye,
  Code2,
  Paintbrush,
  History,
  Download,
  HelpCircle,
  GitFork,
  Rocket,
  GitBranch,
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

type RightTab = 'preview' | 'code'
type MobileTab = 'preview' | 'chat' | 'code' | 'more'

interface SplitViewProps {
  project: Project
  versions: ProjectVersion[]
  messages: ChatMessage[]
  /** True while the clone SSE stream is actively pushing HTML chunks */
  isStreaming?: boolean
  onHtmlChange: (html: string) => void
  onMessagesChange: (messages: ChatMessage[]) => void
  onSaveVersion: (html?: string, label?: string) => void
  onRestoreVersion: (version: ProjectVersion) => void
  onRefetchVersions?: () => void
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
  onRefetchVersions,
}: SplitViewProps) {
  const [rightTab, setRightTab] = useState<RightTab>('preview')
  const [mobileTab, setMobileTab] = useState<MobileTab>('preview')
  const [desktopChatVisible, setDesktopChatVisible] = useState(true)
  const [isFreeUser, setIsFreeUser] = useState(false)
  const [userPlan, setUserPlan] = useState<string>('free')
  const [integrationModal, setIntegrationModal] = useState<'github' | 'vercel' | null>(null)
  // True while the clone SSE stream is active OR the AI chat is streaming
  // isStreamingProp comes from use-project's real-time stream subscription;
  // isGenerating covers the chat streaming case managed locally.
  const [chatGenerating, setChatGenerating] = useState(false)
  const [rebuildInProgress, setRebuildInProgress] = useState(false)
  const [showBrandWizard, setShowBrandWizard] = useState(false)
  // showBrandBanner removed — the chat panel lock handles Brand Rebuild discovery
  // True once any AI rebuild (wizard or chat) has completed for this project.
  // Also true if the saved HTML already contains Tailwind CDN (rebuilt in a previous session)
  // or if there are saved versions (rebuild happened before).
  const [hasBeenRebuilt, setHasBeenRebuilt] = useState(
    messages.length > 0 ||
    versions.length > 0 ||
    (project.html_content?.includes('cdn.tailwindcss.com') ?? false)
  )
  const [showMoreSheet, setShowMoreSheet] = useState(false)
  const [moreContent, setMoreContent] = useState<'visual' | 'history' | null>(null)
  const [activeFolderId, setActiveFolderId] = useState<string | undefined>(project.folder_id ?? undefined)
  const rebuildHtmlRef = useRef('')
  const [imageGenStatus, setImageGenStatus] = useState<{ current: number; total: number } | null>(null)
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
      setHasBeenRebuilt(true)
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

        {/* Folder page switcher — only shown when project is in a folder */}
        {project.folder_id && (
          <FolderPageSwitcher
            folderId={project.folder_id}
            currentProjectId={project.id}
          />
        )}

        {/* Generating indicator — shown during initial clone AND AI chat streaming */}
        {isGenerating && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex-shrink-0">
            <Sparkles className="w-3 h-3 text-amber-500 dark:text-amber-400 animate-pulse" />
            <span className="text-xs text-amber-600 dark:text-amber-400 hidden sm:inline">
              {imageGenStatus
                ? `Generating images… (${imageGenStatus.current}/${imageGenStatus.total})`
                : project.status === 'processing' ? 'Generating…' : 'Writing…'}
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

        <a href="https://whop.com/joined/igualai/" target="_blank" rel="noopener noreferrer">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1 flex-shrink-0"
            title="Support"
          >
            <HelpCircle className="w-3 h-3" />
            <span className="hidden sm:inline">Support</span>
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
            rebuildRequired={!hasBeenRebuilt}
            rebuildInProgress={rebuildInProgress}
            onOpenRebuild={() => setShowBrandWizard(true)}
            versions={versions}
            onRestoreVersion={(version) => {
              onSaveVersion(html)
              onRestoreVersion(version)
              // Toggle Brand Rebuild gate based on whether the restored version is a raw clone or a rebuilt page
              if (version.label === 'Original Clone' || !version.html_content.includes('cdn.tailwindcss.com')) {
                setHasBeenRebuilt(false)
              } else {
                setHasBeenRebuilt(true)
              }
            }}
            onRefetchVersions={onRefetchVersions}
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
            </div>

            {/* ── Desktop layer ────────────────────────────────────────── */}
            <div className="absolute inset-0 hidden sm:block">
              {rightTab === 'preview' && (
                <PreviewPane projectId={project.id} html={html} className="h-full" />
              )}
              {rightTab === 'code' && (
                <CodeEditor value={html} onChange={onHtmlChange} className="h-full" isStreaming={isGenerating} />
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
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setMobileTab(tab.id)}
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


      {/* Brand Rebuild wizard */}
      {showBrandWizard && (
        <BrandWizard
          projectId={project.id}
          projectUrl={project.url}
          folderId={activeFolderId}
          onFolderAssigned={(id) => setActiveFolderId(id)}
          onClose={() => setShowBrandWizard(false)}
          onRebuildStart={() => {
            rebuildHtmlRef.current = ''
            setRightTab('code')
            setChatGenerating(true)
            setRebuildInProgress(true)
          }}
          onHtmlChunk={(chunk) => {
            rebuildHtmlRef.current += chunk
            onHtmlChange(rebuildHtmlRef.current)
          }}
          onRebuildComplete={(finalHtml) => {
            onHtmlChange(finalHtml)
            setChatGenerating(false)
            setRebuildInProgress(false)
            setHasBeenRebuilt(true)
            setRightTab('preview')
            onSaveVersion(finalHtml)
          }}
          onRebuildError={() => {
            setChatGenerating(false)
            setRebuildInProgress(false)
          }}
          onImageGenStatus={(status) => setImageGenStatus(status)}
        />
      )}

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
