'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import {
  Loader2,
  User,
  CreditCard,
  Zap,
  BarChart3,
  ArrowUpRight,
  CheckCircle2,
  Mail,
  Package,
  Globe,
  Trash2,
  AlertTriangle,
  ShieldCheck,
  Plus,
} from 'lucide-react'
import type { User as DbUser, CustomDomain, Project } from '@/types'
import { PLAN_LIMITS } from '@/types'
import { formatTokens } from '@/lib/utils'
import Link from 'next/link'

export default function SettingsPage() {
  const { isSignedIn, isLoaded, user } = useAuth()
  const router = useRouter()
  const [dbUser, setDbUser] = useState<DbUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)
  const [tokenPackLoading, setTokenPackLoading] = useState<string | null>(null)
  const [domains, setDomains] = useState<CustomDomain[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [newDomain, setNewDomain] = useState('')
  const [newDomainProjectId, setNewDomainProjectId] = useState('')
  const [addingDomain, setAddingDomain] = useState(false)
  const [verifyingDomain, setVerifyingDomain] = useState<string | null>(null)
  const [deletingDomain, setDeletingDomain] = useState<string | null>(null)
  const [provisioningSSL, setProvisioningSSL] = useState<string | null>(null)
  const [pendingDnsId, setPendingDnsId] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push('/')
    }
  }, [isLoaded, isSignedIn, router])

  useEffect(() => {
    // Check for success param from Stripe
    const params = new URLSearchParams(window.location.search)
    if (params.get('success') === 'true') {
      const plan = params.get('plan')
      setSuccessMessage(`Successfully upgraded to ${plan} plan!`)
      router.replace('/settings')
    } else if (params.get('tokens') === 'true') {
      const pack = params.get('pack')
      const amounts: Record<string, string> = { small: '30,000', medium: '70,000', large: '200,000' }
      setSuccessMessage(`${amounts[pack ?? ''] ?? ''} tokens added to your account!`)
      router.replace('/settings')
    }
  }, [router])

  useEffect(() => {
    if (!isSignedIn) return
    fetchUser()
    fetchDomains()
    fetchProjects()
  }, [isSignedIn])

  const fetchUser = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/user')
      if (!res.ok) return
      const data = await res.json()
      setDbUser({
        plan: data.plan,
        tokens_used: data.tokens_used,
        clones_count: data.clones_count,
        is_admin: data.is_admin,
      } as DbUser)
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }

  const fetchDomains = async () => {
    try {
      const res = await fetch('/api/domains')
      if (res.ok) {
        const data = await res.json()
        setDomains(data.domains ?? [])
      }
    } catch { /* silently fail */ }
  }

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects')
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects ?? [])
      }
    } catch { /* silently fail */ }
  }

  const handleAddDomain = async () => {
    if (!newDomain.trim() || !newDomainProjectId) return
    setAddingDomain(true)
    try {
      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: newDomain.trim(), project_id: newDomainProjectId }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Failed to add domain'); return }
      setDomains((prev) => [data.domain, ...prev])
      setPendingDnsId(data.domain.id)
      setNewDomain('')
      setNewDomainProjectId('')
    } catch { alert('Failed to add domain') }
    finally { setAddingDomain(false) }
  }

  const handleVerifyDomain = async (id: string) => {
    setVerifyingDomain(id)
    try {
      const res = await fetch(`/api/domains/${id}`)
      const data = await res.json()
      if (data.verified) {
        setDomains((prev) => prev.map((d) => d.id === id ? { ...d, verified: true } : d))
        setPendingDnsId(null)
      } else {
        alert('DNS not yet propagated. Make sure the A record is set and try again.')
      }
    } catch { alert('Verification failed') }
    finally { setVerifyingDomain(null) }
  }

  const handleDeleteDomain = async (id: string) => {
    if (!confirm('Delete this domain?')) return
    setDeletingDomain(id)
    try {
      const res = await fetch(`/api/domains/${id}`, { method: 'DELETE' })
      if (res.ok) setDomains((prev) => prev.filter((d) => d.id !== id))
    } catch { /* silently fail */ }
    finally { setDeletingDomain(null) }
  }

  const handleProvisionSSL = async (id: string) => {
    setProvisioningSSL(id)
    try {
      const res = await fetch(`/api/domains/${id}/ssl`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        if (data.ssl_provisioned) {
          // Already done
          setDomains((prev) => prev.map((d) => d.id === id ? { ...d, ssl_provisioned: true } : d))
        } else {
          // Queued — cron provisions within ~1 minute
          setSuccessMessage('SSL provisioning started — certificate will be ready within 1–2 minutes. Refresh to see the badge.')
        }
      } else {
        alert(data.error || 'SSL provisioning failed')
      }
    } catch { alert('SSL provisioning failed') }
    finally { setProvisioningSSL(null) }
  }

  const handleBuyTokenPack = async (pack: string) => {
    setTokenPackLoading(pack)
    try {
      const res = await fetch('/api/stripe/token-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to start checkout. Please try again.')
        return
      }
      if (data.url) window.location.href = data.url
    } catch {
      alert('Failed to start checkout. Please try again.')
    } finally {
      setTokenPackLoading(null)
    }
  }

  const handleManageBilling = async () => {
    setPortalLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert(data.error || 'Failed to open billing portal')
      }
    } catch {
      alert('Failed to open billing portal')
    } finally {
      setPortalLoading(false)
    }
  }

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
      </div>
    )
  }

  const plan = dbUser?.plan || 'free'
  const isAdmin = dbUser?.is_admin ?? false
  const tokensUsed = dbUser?.tokens_used || 0
  const tokenLimit = PLAN_LIMITS[plan]?.tokens || 10000
  const tokenPercent = isAdmin ? 0 : Math.min(Math.round((tokensUsed / tokenLimit) * 100), 100)
  const barColor = tokenPercent >= 90 ? '#ef4444' : tokenPercent >= 70 ? '#f59e0b' : '#22c55e'

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <Header />

      <main className="pt-24 max-w-3xl mx-auto px-4 pb-16">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2">
          Account Settings
        </h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-8">
          Manage your account, billing, and preferences.
        </p>

        {/* Success banner */}
        {successMessage && (
          <div className="flex items-center gap-3 p-4 mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-green-700 dark:text-green-400 text-sm">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            {successMessage}
          </div>
        )}

        <div className="space-y-6">
          {/* Account Info */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-neutral-500" />
                <CardTitle className="text-base">Account Information</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div>
                  <p className="font-medium text-neutral-900 dark:text-white">
                    {user?.name || 'User'}
                  </p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {user?.email}
                  </p>
                </div>
              </div>
              <Separator />
              <a href="https://whop.com/my-account/" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  Edit Profile on Whop
                  <ArrowUpRight className="w-3 h-3 ml-1" />
                </Button>
              </a>
            </CardContent>
          </Card>

          {/* Current Plan */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-neutral-500" />
                <CardTitle className="text-base">Current Plan</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-neutral-900 dark:text-white capitalize">
                      {plan}
                    </span>
                    <Badge variant={plan === 'free' ? 'secondary' : 'success'}>
                      {plan === 'free' ? 'Free' : 'Active'}
                    </Badge>
                  </div>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
                    {formatTokens(tokenLimit)} AI tokens/month
                  </p>
                </div>
                {plan === 'free' ? (
                  <Button size="sm" asChild>
                    <Link href="/pricing">
                      <Zap className="w-3 h-3 mr-1" />
                      Upgrade
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={handleManageBilling} disabled={portalLoading}>
                    {portalLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      'Manage Subscription'
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Usage Stats */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-neutral-500" />
                <CardTitle className="text-base">Usage</CardTitle>
              </div>
              <CardDescription>Your usage this billing period</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Token usage */}
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-neutral-600 dark:text-neutral-400">AI Tokens</span>
                  <span className="text-neutral-900 dark:text-white font-medium">
                    {isAdmin ? 'Unlimited' : `${formatTokens(tokensUsed)} / ${formatTokens(tokenLimit)}`}
                  </span>
                </div>
                {!isAdmin && (
                  <>
                    <div className="h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${tokenPercent}%`, backgroundColor: barColor }}
                      />
                    </div>
                    <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
                      {tokenPercent}% used
                    </p>
                  </>
                )}
              </div>

              {/* Clones count */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-600 dark:text-neutral-400">Total Clones</span>
                <span className="font-medium text-neutral-900 dark:text-white">
                  {dbUser?.clones_count || 0}
                  {!isAdmin && plan === 'free' ? ' / 1' : isAdmin ? ' / Unlimited' : ''}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Custom Domains */}
          <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-neutral-500" />
                  <CardTitle className="text-base">Custom Domains</CardTitle>
                </div>
                <CardDescription>Connect a custom domain to one of your cloned pages.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Domain list */}
                {domains.length > 0 && (
                  <div className="space-y-3">
                    {domains.map((d) => (
                      <div key={d.id} className="flex flex-col gap-2 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {d.verified ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-neutral-900 dark:text-white truncate">{d.domain}</p>
                              {d.project_name && (
                                <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{d.project_name}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {d.verified && !d.ssl_provisioned && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs px-2 gap-1"
                                onClick={() => handleProvisionSSL(d.id)}
                                disabled={provisioningSSL === d.id}
                              >
                                {provisioningSSL === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                                SSL
                              </Button>
                            )}
                            {d.verified && d.ssl_provisioned && (
                              <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3" /> SSL
                              </span>
                            )}
                            {!d.verified && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs px-2"
                                onClick={() => handleVerifyDomain(d.id)}
                                disabled={verifyingDomain === d.id}
                              >
                                {verifyingDomain === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Verify DNS'}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-neutral-400 hover:text-red-500"
                              onClick={() => handleDeleteDomain(d.id)}
                              disabled={deletingDomain === d.id}
                            >
                              {deletingDomain === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            </Button>
                          </div>
                        </div>
                        {/* DNS instructions — shown right after adding */}
                        {pendingDnsId === d.id && !d.verified && (
                          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                            <p className="font-semibold">Add this DNS record at your registrar:</p>
                            <p>Type: <span className="font-mono font-bold">A</span></p>
                            <p>Name: <span className="font-mono font-bold">@</span></p>
                            <p>Value: <span className="font-mono font-bold">187.124.219.202</span></p>
                            <p className="mt-1 text-amber-600 dark:text-amber-400">Then click Verify DNS once it propagates (may take a few minutes).</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Add domain form */}
                <div className="space-y-2.5">
                  <div className="flex gap-2">
                    <Input
                      placeholder="yourdomain.com"
                      value={newDomain}
                      onChange={(e) => setNewDomain(e.target.value)}
                      className="h-9 text-sm flex-1"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddDomain()}
                    />
                    <select
                      value={newDomainProjectId}
                      onChange={(e) => setNewDomainProjectId(e.target.value)}
                      className="h-9 text-sm px-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white flex-1 max-w-[180px]"
                    >
                      <option value="">Select project…</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      className="h-9 px-3 gap-1"
                      onClick={handleAddDomain}
                      disabled={addingDomain || !newDomain.trim() || !newDomainProjectId}
                    >
                      {addingDomain ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Add
                    </Button>
                  </div>
                </div>
              </CardContent>
          </Card>

          {/* Buy Extra Tokens — Pro and Agency only */}
          {(plan === 'pro' || plan === 'agency') && !isAdmin && <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-neutral-500" />
                  <CardTitle className="text-base">Buy Extra Tokens</CardTitle>
                </div>
                <CardDescription>One-time token packs that extend your monthly allowance.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { pack: 'small', label: 'Small', tokens: '30,000', price: 5 },
                    { pack: 'medium', label: 'Medium', tokens: '70,000', price: 10 },
                    { pack: 'large', label: 'Large', tokens: '200,000', price: 25 },
                  ].map(({ pack, label, tokens, price }) => (
                    <div
                      key={pack}
                      className="flex flex-col items-center gap-3 p-4 rounded-xl border border-neutral-200 dark:border-neutral-700 text-center"
                    >
                      <div>
                        <p className="font-semibold text-neutral-900 dark:text-white text-sm">{label}</p>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{tokens} tokens</p>
                      </div>
                      <p className="text-2xl font-bold text-neutral-900 dark:text-white">${price}</p>
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => handleBuyTokenPack(pack)}
                        disabled={tokenPackLoading === pack}
                      >
                        {tokenPackLoading === pack ? (
                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        ) : null}
                        Buy
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
          </Card>}

          {/* Contact Support */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-neutral-500" />
                <CardTitle className="text-base">Contact Support</CardTitle>
              </div>
              <CardDescription>For billing and subscription questions, email us directly.</CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href="mailto:support@igualai.com"
                className="inline-flex items-center gap-2 text-sm font-medium text-neutral-900 dark:text-white underline underline-offset-2 hover:no-underline"
              >
                <Mail className="w-4 h-4" />
                support@igualai.com
              </a>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
                We typically respond within 24 hours on business days.
              </p>
            </CardContent>
          </Card>

          {/* Billing */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-neutral-500" />
                <CardTitle className="text-base">Billing</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {plan === 'free' ? (
                <div className="text-center py-4">
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
                    No billing history. Upgrade to a paid plan to access premium features.
                  </p>
                  <Button asChild>
                    <Link href="/pricing">View Plans</Link>
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={handleManageBilling} disabled={portalLoading}>
                  {portalLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-2" />
                  ) : (
                    <CreditCard className="w-3 h-3 mr-2" />
                  )}
                  View Billing History
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

    </div>
  )
}
