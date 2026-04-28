'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, useClerk } from '@clerk/nextjs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, ArrowRight, AlertCircle } from 'lucide-react'
import { isValidUrl } from '@/lib/utils'

export function UrlInput() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const { isSignedIn } = useUser()
  const { openSignIn } = useClerk()

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
    try {
      const res = await fetch('/api/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Something went wrong')
      }

      router.push(`/editor/${data.projectId as string}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setLoading(false)
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
              Creating...
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
    </div>
  )
}
