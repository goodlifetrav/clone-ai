'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, useClerk } from '@clerk/nextjs'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, ArrowRight, AlertCircle, Zap } from 'lucide-react'
import { isValidUrl } from '@/lib/utils'

export function UrlInput() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
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
        if (data.upgradeRequired) {
          setShowUpgradeModal(true)
          setLoading(false)
          return
        }
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

      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowUpgradeModal(false)}
          />
          <div className="relative bg-white dark:bg-neutral-900 rounded-2xl shadow-xl p-6 max-w-sm w-full border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/50 mx-auto mb-4">
              <Zap className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-lg font-bold text-neutral-900 dark:text-white text-center mb-2">
              Free Clone Used
            </h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center mb-6">
              You&apos;ve used your free clone. Upgrade to Pro for more cloning.
            </p>
            <div className="flex flex-col gap-2">
              <Link href="/pricing" className="w-full">
                <Button className="w-full gap-2">
                  <Zap className="w-4 h-4" />
                  Upgrade Now
                </Button>
              </Link>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setShowUpgradeModal(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
