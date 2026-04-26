'use client'

import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { useProject } from '@/hooks/use-project'
import { SplitView } from '@/components/editor/split-view'
import { Loader2, AlertCircle } from 'lucide-react'
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
