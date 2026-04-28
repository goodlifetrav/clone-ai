'use client'

import { useState, useEffect } from 'react'
import { useUser, UserProfile } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Loader2,
  User,
  CreditCard,
  Zap,
  BarChart3,
  ArrowUpRight,
  CheckCircle2,
  Mail,
} from 'lucide-react'
import type { User as DbUser } from '@/types'
import { PLAN_LIMITS } from '@/types'
import { formatTokens } from '@/lib/utils'
import Link from 'next/link'

export default function SettingsPage() {
  const { isSignedIn, isLoaded, user } = useUser()
  const router = useRouter()
  const [dbUser, setDbUser] = useState<DbUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [showProfileModal, setShowProfileModal] = useState(false)

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
      // Clean URL
      router.replace('/settings')
    }
  }, [router])

  useEffect(() => {
    if (!isSignedIn) return
    fetchUser()
  }, [isSignedIn])

  const fetchUser = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/projects') // triggers user creation if needed
      // Try to get user data via a separate endpoint
      // For now, construct from Clerk user data
      setDbUser(null)
    } catch {
      // silently fail
    } finally {
      setLoading(false)
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
  const tokensUsed = dbUser?.tokens_used || 0
  const tokenLimit = PLAN_LIMITS[plan]?.tokens || 10000
  const tokenPercent = Math.min(Math.round((tokensUsed / tokenLimit) * 100), 100)

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
                {user?.imageUrl && (
                  <img
                    src={user.imageUrl}
                    alt="Avatar"
                    className="w-12 h-12 rounded-full border border-neutral-200 dark:border-neutral-700"
                  />
                )}
                <div>
                  <p className="font-medium text-neutral-900 dark:text-white">
                    {user?.fullName || 'User'}
                  </p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {user?.emailAddresses?.[0]?.emailAddress}
                  </p>
                  {user?.phoneNumbers?.[0] && (
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      {user.phoneNumbers[0].phoneNumber}
                    </p>
                  )}
                </div>
              </div>
              <Separator />
              <Button variant="outline" size="sm" onClick={() => setShowProfileModal(true)}>
                Edit Profile
                <ArrowUpRight className="w-3 h-3 ml-1" />
              </Button>
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
                    {formatTokens(tokensUsed)} / {formatTokens(tokenLimit)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-neutral-900 dark:bg-white transition-all duration-500"
                    style={{ width: `${tokenPercent}%` }}
                  />
                </div>
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
                  {tokenPercent}% used
                </p>
              </div>

              {/* Clones count */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-600 dark:text-neutral-400">Total Clones</span>
                <span className="font-medium text-neutral-900 dark:text-white">
                  {dbUser?.clones_count || 0}
                  {plan === 'free' ? ' / 1' : ''}
                </span>
              </div>
            </CardContent>
          </Card>

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

      {/* Clerk UserProfile modal */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowProfileModal(false)}
          />
          <div className="relative z-10 max-h-[90vh] overflow-auto rounded-2xl shadow-2xl">
            <UserProfile />
          </div>
        </div>
      )}
    </div>
  )
}
