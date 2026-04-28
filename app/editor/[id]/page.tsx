'use client'

import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { useProject } from '@/hooks/use-project'
import { SplitView } from '@/components/editor/split-view'
import { Loader2, AlertCircle, Sparkles, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function EditorPage() {
  const params = useParams()
  const id = params.id as string
  const { isSignedIn, isLoaded } = useUser()
  const router = useRouter()

  const {
    project,
    versions,
    messages,
    setMessages,
    loading,
    error,
    updateHtml,
    saveVersion,
    restoreVersion,
  } = useProject(id)

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push('/')
    }
  }, [isLoaded, isSignedIn, router])

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-neutral-950">
        <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-white dark:bg-neutral-950 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
        <p className="text-sm text-neutral-500">Loading project...</p>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-white dark:bg-neutral-950 gap-4">
        <AlertCircle className="w-10 h-10 text-red-400" />
        <div className="text-center">
          <h2 className="font-semibold text-neutral-900 dark:text-white mb-1">Project not found</h2>
          <p className="text-sm text-neutral-500">{error || 'This project does not exist'}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    )
  }

  // Show a holding screen while the clone is being generated in the background
  if (project.status === 'processing') {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-white dark:bg-neutral-950 px-4 text-center gap-6">
        <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
          <Sparkles className="w-8 h-8 text-neutral-500 dark:text-neutral-300 animate-pulse" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2">
            Generating Your Clone
          </h2>
          <p className="text-neutral-500 dark:text-neutral-400 max-w-sm">
            We&apos;re scraping the page and rebuilding it with AI. This usually takes 30–90 seconds.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Processing in background — checking for updates…
        </div>
        <p className="text-xs text-neutral-400 dark:text-neutral-500 max-w-xs">
          You can close this tab and come back later. Your clone will appear in My Projects when it&apos;s ready.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard" className="gap-2">
            <LayoutGrid className="w-4 h-4" />
            View My Projects
          </Link>
        </Button>
      </div>
    )
  }

  // Show error state if clone failed
  if (project.status === 'error') {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-white dark:bg-neutral-950 gap-4">
        <AlertCircle className="w-10 h-10 text-red-400" />
        <div className="text-center">
          <h2 className="font-semibold text-neutral-900 dark:text-white mb-1">Clone Failed</h2>
          <p className="text-sm text-neutral-500">
            Something went wrong while cloning this website. Please try again.
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild variant="outline">
            <Link href="/">Try Again</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">My Projects</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <SplitView
      project={project}
      versions={versions}
      messages={messages}
      onHtmlChange={updateHtml}
      onMessagesChange={setMessages}
      onSaveVersion={saveVersion}
      onRestoreVersion={restoreVersion}
    />
  )
}
