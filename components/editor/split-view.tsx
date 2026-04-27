'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { PreviewPane } from './preview-pane'
import { CodeEditor } from './code-editor'
import { ChatPanel } from './chat-panel'
import { VisualEditor } from './visual-editor'
import { TerminalPanel } from './terminal-panel'
import { VersionHistory } from './version-history'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Eye,
  Code2,
  Columns2,
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

type ViewMode = 'preview' | 'code' | 'split'
type PanelMode = 'chat' | 'visual' | 'terminal' | 'versions'

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
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const [panelMode, setPanelMode] = useState<PanelMode>('chat')
  const [deploying, setDeploying] = useState(false)
  const [showUpgradeBadge, setShowUpgradeBadge] = useState(false)
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

  // Inject visual editor CSS
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

  return (
    <div className="relative flex flex-col h-screen bg-white dark:bg-neutral-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex-shrink-0">
        {/* Navigation */}
        <Link href="/">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
            <Plus className="w-3 h-3" />
            New Clone
          </Button>
        </Link>

        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
            <LayoutGrid className="w-3 h-3" />
            My Projects
          </Button>
        </Link>

        <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700 mx-1" />

        {/* Project name */}
        <div className="font-medium text-sm truncate max-w-48 text-neutral-700 dark:text-neutral-300">
          {project.name}
        </div>

        <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700 mx-1" />

        {/* View mode */}
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
          <TabsList className="h-8">
            <TabsTrigger value="preview" className="px-2 h-6 text-xs gap-1">
              <Eye className="w-3 h-3" /> Preview
            </TabsTrigger>
            <TabsTrigger value="split" className="px-2 h-6 text-xs gap-1">
              <Columns2 className="w-3 h-3" /> Split
            </TabsTrigger>
            <TabsTrigger value="code" className="px-2 h-6 text-xs gap-1">
              <Code2 className="w-3 h-3" /> Code
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700 mx-1" />

        {/* Panel mode */}
        <div className="flex gap-1">
          {(
            [
              { mode: 'chat' as PanelMode, icon: null, label: 'Chat' },
              { mode: 'visual' as PanelMode, icon: <Paintbrush className="w-3 h-3" />, label: 'Visual' },
              { mode: 'terminal' as PanelMode, icon: <Terminal className="w-3 h-3" />, label: 'Terminal' },
              { mode: 'versions' as PanelMode, icon: <History className="w-3 h-3" />, label: 'Versions' },
            ] as { mode: PanelMode; icon: React.ReactNode; label: string }[]
          ).map(({ mode, icon, label }) => (
            <Button
              key={mode}
              variant={panelMode === mode ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => setPanelMode(mode)}
            >
              {icon}
              {label}
            </Button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Actions */}
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={handleFork}>
          <GitFork className="w-3 h-3" />
          Fork
        </Button>

        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={handleDownload}>
          <Download className="w-3 h-3" />
          Download
        </Button>

        {showUpgradeBadge && (
          <Link href="/pricing">
            <Button
              size="sm"
              className="h-7 px-3 text-xs gap-1 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white border-0"
            >
              <Zap className="w-3 h-3" />
              Upgrade
            </Button>
          </Link>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-7 px-3 text-xs gap-1" disabled={deploying}>
              {deploying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rocket className="w-3 h-3" />}
              Deploy
              <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleDeploy}>
              <Rocket className="w-4 h-4 mr-2" />
              Deploy to Vercel
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => alert('Connect GitHub in settings to push to a repo')}>
              <GitBranch className="w-4 h-4 mr-2" />
              Push to GitHub
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => alert('Connect Shopify in settings to deploy')}>
              <ShoppingBag className="w-4 h-4 mr-2" />
              Deploy to Shopify
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Main area — flex-row so preview gets full height independent of chat panel */}
      <div className="flex flex-1 overflow-hidden">

        {/* Preview column — full height, no bottom panel competing for space */}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div className={`flex flex-col overflow-hidden h-full ${viewMode === 'split' ? 'w-1/2 border-r border-neutral-200 dark:border-neutral-800' : 'w-full'}`}>
            <PreviewPane projectId={project.id} html={displayHtml} className="flex-1 min-h-0" />
          </div>
        )}

        {/* Code + bottom panel column */}
        {(viewMode === 'code' || viewMode === 'split') && (
          <div className={`flex flex-col overflow-hidden h-full ${viewMode === 'split' ? 'w-1/2' : 'w-full'}`}>
            {/* Code editor grows to fill remaining height above the panel */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <CodeEditor value={html} onChange={onHtmlChange} className="h-full" />
            </div>

            {/* Bottom panel — lives inside the code column only */}
            <div className="h-64 flex-shrink-0 border-t border-neutral-200 dark:border-neutral-800">
              {panelMode === 'chat' && (
                <ChatPanel
                  projectId={project.id}
                  currentHtml={html}
                  messages={messages}
                  onMessagesChange={onMessagesChange}
                  onHtmlChange={onHtmlChange}
                />
              )}
              {panelMode === 'visual' && (
                <VisualEditor onStyleChange={setVisualCss} className="h-full" />
              )}
              {panelMode === 'terminal' && <TerminalPanel html={html} />}
              {panelMode === 'versions' && (
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
        )}

        {/* In preview-only mode there's no code column, so show the bottom panel
            as a floating overlay so chat/versions are still accessible */}
        {viewMode === 'preview' && (
          <div className="absolute bottom-0 left-0 right-0 h-64 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 z-20">
            {panelMode === 'chat' && (
              <ChatPanel
                projectId={project.id}
                currentHtml={html}
                messages={messages}
                onMessagesChange={onMessagesChange}
                onHtmlChange={onHtmlChange}
              />
            )}
            {panelMode === 'visual' && (
              <VisualEditor onStyleChange={setVisualCss} className="h-full" />
            )}
            {panelMode === 'terminal' && <TerminalPanel html={html} />}
            {panelMode === 'versions' && (
              <VersionHistory
                versions={versions}
                currentHtml={html}
                onRestore={onRestoreVersion}
                onSaveVersion={onSaveVersion}
                className="h-full"
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
