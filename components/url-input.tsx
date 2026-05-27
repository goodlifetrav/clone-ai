'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, ArrowRight, AlertCircle, Zap, Check } from 'lucide-react'
import { isValidUrl } from '@/lib/utils'

export function UrlInput() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [upgrading, setUpgrading] = useState(false)
  const [error, setError] = useState('')
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const router = useRouter()
  const { isSignedIn, signIn } = useAuth()

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
      signIn()
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

  const handleUpgrade = async () => {
    setUpgrading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'pro' }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch {
      setUpgrading(false)
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
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowUpgradeModal(false)} />
          <div className="relative bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl p-7 max-w-sm w-full border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-violet-100 dark:bg-violet-950/50 mx-auto mb-4">
              <Zap className="w-6 h-6 text-violet-600 dark:text-violet-400" />
            </div>
            <h2 className="text-xl font-bold text-neutral-900 dark:text-white text-center mb-2">
              Your free clone is done — want more?
            </h2>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center mb-5">
              Upgrade to Pro for <span className="font-semibold text-neutral-700 dark:text-neutral-300">$19/mo</span> and unlock 20 clones a month, AI brand rebuilds, and unlimited editing.
            </p>
            <ul className="space-y-2 mb-6">
              {[
                '20 page clones per month',
                'AI Brand Rebuild — make any site yours',
                '2M AI tokens (~28 full rebuilds)',
                'Custom domain & hosting',
              ].map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                  <Check className="w-4 h-4 text-violet-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <Button
              className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white"
              onClick={handleUpgrade}
              disabled={upgrading}
            >
              {upgrading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {upgrading ? 'Redirecting...' : 'Get Pro — $19/mo'}
            </Button>
            <button
              className="w-full mt-3 text-xs text-neutral-400 hover:text-neutral-500 dark:hover:text-neutral-300 transition-colors"
              onClick={() => setShowUpgradeModal(false)}
            >
              Maybe later
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
