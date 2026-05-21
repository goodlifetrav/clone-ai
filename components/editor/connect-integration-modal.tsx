'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X, GitBranch, Rocket, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

type Service = 'github' | 'vercel'

interface ConnectIntegrationModalProps {
  service: Service
  projectId: string
  onClose: () => void
}

const META: Record<Service, { label: string; icon: React.ReactNode; color: string }> = {
  github: {
    label: 'GitHub',
    icon: <GitBranch className="w-6 h-6" />,
    color: 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900',
  },
  vercel: {
    label: 'Vercel',
    icon: <Rocket className="w-6 h-6" />,
    color: 'bg-black text-white',
  },
}

export function ConnectIntegrationModal({
  service,
  projectId,
  onClose,
}: ConnectIntegrationModalProps) {
  const meta = META[service]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-neutral-900 rounded-2xl shadow-xl p-6 max-w-md w-full border border-neutral-200 dark:border-neutral-800">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${meta.color}`}>
            {meta.icon}
          </div>
          <div>
            <h2 className="font-bold text-neutral-900 dark:text-white">
              Connect {meta.label}
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Push your project directly to {meta.label}
            </p>
          </div>
        </div>

        {service === 'github' && (
          <GitHubPanel projectId={projectId} onClose={onClose} />
        )}
        {service === 'vercel' && (
          <VercelPanel projectId={projectId} onClose={onClose} />
        )}
      </div>
    </div>
  )
}

function GitHubPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [token, setToken] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('gh_token') ?? '' : ''
  )
  const [repoName, setRepoName] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ repoUrl: string; pagesUrl: string } | null>(null)
  const [error, setError] = useState('')

  const handlePush = async () => {
    if (!token.trim() || !repoName.trim()) return
    setLoading(true)
    setError('')
    try {
      if (typeof window !== 'undefined') localStorage.setItem('gh_token', token)

      const res = await fetch('/api/integrations/github/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, token, repoName, isPrivate }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Push failed')
      setResult({ repoUrl: data.repoUrl, pagesUrl: data.pagesUrl })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed')
    } finally {
      setLoading(false)
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-medium">Pushed to GitHub!</span>
        </div>
        <div className="space-y-2">
          <a
            href={result.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 underline"
          >
            <ExternalLink className="w-3 h-3" />
            View repository
          </a>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Enable GitHub Pages in repository settings to get a live URL.
          </p>
        </div>
        <Button className="w-full" onClick={onClose}>Done</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-neutral-600 dark:text-neutral-400 space-y-1">
        <p>
          You need a{' '}
          <a
            href="https://github.com/settings/tokens/new?scopes=repo&description=IgualAI"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 underline"
          >
            GitHub personal access token
          </a>{' '}
          with <strong>repo</strong> scope.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1 block">
            Personal Access Token
          </label>
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxx"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1 block">
            Repository Name
          </label>
          <Input
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            placeholder="my-cloned-site"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 cursor-pointer">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="rounded"
          />
          Private repository
        </label>
      </div>

      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}

      <Button
        className="w-full gap-2"
        onClick={handlePush}
        disabled={loading || !token.trim() || !repoName.trim()}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
        Push to GitHub
      </Button>
    </div>
  )
}

function VercelPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [token, setToken] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('vercel_token') ?? '' : ''
  )
  const [loading, setLoading] = useState(false)
  const [deployUrl, setDeployUrl] = useState('')
  const [error, setError] = useState('')

  const handleDeploy = async () => {
    if (!token.trim()) return
    setLoading(true)
    setError('')
    try {
      if (typeof window !== 'undefined') localStorage.setItem('vercel_token', token)

      const res = await fetch('/api/deploy/vercel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, token }),
      })
      const data = await res.json()

      if (data.upgradeRequired) {
        setError('Vercel deployment requires a Pro plan or above.')
        return
      }
      if (!res.ok) throw new Error(data.error || 'Deploy failed')

      setDeployUrl(data.deployUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed')
    } finally {
      setLoading(false)
    }
  }

  if (deployUrl) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-medium">Deployed to Vercel!</span>
        </div>
        <a
          href={deployUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 underline"
        >
          <ExternalLink className="w-3 h-3" />
          {deployUrl}
        </a>
        <Button className="w-full" onClick={onClose}>Done</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-neutral-600 dark:text-neutral-400 space-y-1">
        <p>
          You need a{' '}
          <a
            href="https://vercel.com/account/tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 underline"
          >
            Vercel access token
          </a>{' '}
          from your account settings.
        </p>
      </div>

      <div>
        <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1 block">
          Access Token
        </label>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
        />
      </div>

      {error && (
        <div className="space-y-2">
          <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          {error.includes('Pro') && (
            <Link href="/pricing">
              <Button size="sm" className="w-full">Upgrade to Pro</Button>
            </Link>
          )}
        </div>
      )}

      <Button
        className="w-full gap-2"
        onClick={handleDeploy}
        disabled={loading || !token.trim()}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Rocket className="w-4 h-4" />
        )}
        Deploy to Vercel
      </Button>
    </div>
  )
}

