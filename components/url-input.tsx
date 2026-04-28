'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, useClerk } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react'
import { isValidUrl } from '@/lib/utils'

type StepStatus = 'pending' | 'active' | 'done'

interface Step {
  label: string
  status: StepStatus
}

const INITIAL_STEPS: Step[] = [
  { label: 'Launching browser...', status: 'pending' },
  { label: 'Visiting page...', status: 'pending' },
  { label: 'Taking screenshot...', status: 'pending' },
  { label: 'Extracting HTML and CSS...', status: 'pending' },
  { label: 'Sending to Claude AI...', status: 'pending' },
  { label: 'Generating clone...', status: 'pending' },
  { label: 'Saving project...', status: 'pending' },
]

// Map incoming step text to index in INITIAL_STEPS
const STEP_INDEX: Record<string, number> = {
  'Launching browser...': 0,
  'Taking screenshot...': 2,
  'Extracting HTML and CSS...': 3,
  'Sending to Claude AI...': 4,
  'Generating clone...': 5,
  'Saving project...': 6,
}

function getStepIndex(label: string, url: string): number {
  if (label.startsWith('Visiting')) return 1
  return STEP_INDEX[label] ?? -1
}

export function UrlInput() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS)
  const router = useRouter()
  const { isSignedIn } = useUser()
  const { openSignIn } = useClerk()

  function activateStep(label: string, currentUrl: string) {
    const idx = getStepIndex(label, currentUrl)
    if (idx === -1) return
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i < idx) return { ...s, status: 'done' }
        if (i === idx) return { ...s, label, status: 'active' }
        return s
      })
    )
  }

  function completeAllSteps() {
    setSteps((prev) => prev.map((s) => ({ ...s, status: 'done' })))
  }

  const handleClone = async () => {
    setError('')

    let normalizedUrl = url.trim()
    if (!normalizedUrl) return

    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`
    }

    if (!isValidUrl(normalizedUrl)) {
      setError('Please enter a valid URL')
      return
    }

    if (!isSignedIn) {
      openSignIn()
      return
    }

    setLoading(true)
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: 'pending' })))

    try {
      const res = await fetch('/api/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl }),
      })

      if (!res.body) throw new Error('No response stream')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const text = line.slice(6).trim()
          if (!text) continue

          let data: Record<string, unknown>
          try {
            data = JSON.parse(text)
          } catch {
            continue
          }

          if (data.error) {
            throw new Error(
              typeof data.error === 'string' ? data.error : 'Something went wrong'
            )
          }

          if (data.step && typeof data.step === 'string') {
            activateStep(data.step, normalizedUrl)
          }

          // Redirect as soon as the project ID is available so the user
          // can close the tab and clone continues in the background.
          if (data.processing && data.projectId) {
            router.push(`/editor/${data.projectId as string}`)
            return
          }

          if (data.done && data.projectId) {
            completeAllSteps()
            await new Promise((r) => setTimeout(r, 400))
            router.push(`/editor/${data.projectId}`)
            return
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setLoading(false)
      setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: 'pending' })))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleClone()
  }

  return (
    <div className="w-full max-w-2xl space-y-4">
      <div className="flex gap-2">
        <Input
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-12 text-base px-4 flex-1 rounded-xl border-neutral-200 dark:border-neutral-700 shadow-sm"
          disabled={loading}
          autoFocus
        />
        <Button
          onClick={handleClone}
          disabled={loading || !url.trim()}
          className="h-12 px-6 rounded-xl text-base font-medium"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Cloning...
            </>
          ) : (
            <>
              Clone
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 px-5 py-4 space-y-2.5">
          {steps.map((step) => (
            <div key={step.label} className="flex items-center gap-3">
              <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                {step.status === 'done' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : step.status === 'active' ? (
                  <Loader2 className="w-4 h-4 text-neutral-500 dark:text-neutral-400 animate-spin" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-300 dark:bg-neutral-700" />
                )}
              </span>
              <span
                className={
                  step.status === 'done'
                    ? 'text-sm text-emerald-600 dark:text-emerald-400'
                    : step.status === 'active'
                    ? 'text-sm font-medium text-neutral-900 dark:text-white'
                    : 'text-sm text-neutral-400 dark:text-neutral-600'
                }
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
