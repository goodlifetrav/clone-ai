'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Users, TrendingUp, Globe, Zap, Copy, ArrowUpRight, RefreshCw, DollarSign, Activity, CheckCircle, XCircle, Clock } from 'lucide-react'

type Period = 'today' | 'yesterday' | '7d' | '30d'

interface CloneActivity {
  id: string
  url: string
  name: string
  status: 'complete' | 'error' | 'pending'
  created_at: string
  email: string
  plan: string
}

interface Stats {
  period: string
  users: {
    total: number
    thisPeriod: number
    plans: Record<string, number>
    paid: number
    mrr: number
    totalTokens: number
  }
  clones: { total: number; thisPeriod: number }
  traffic: { visitorsToday: number; visitorsPeriod: number; sources: { source: string; count: number; pct: number }[]; signupSources: { source: string; count: number; pct: number }[]; countries: { country: string; count: number }[] }
  conversions: { signupToPaid: number; visitToSignup: number }
  chartData: { date: string; count: number }[]
  topUsers: { email: string; plan: string; tokens_used: number; clones_count: number }[]
  allPaidUsers: { email: string; plan: string; created_at: string; tokens_used: number }[]
  recentUsers: { email: string; plan: string; created_at: string; tokens_used: number; clones_count: number }[]
}

const FLAG_EMOJI: Record<string, string> = {
  US: '🇺🇸', GB: '🇬🇧', CA: '🇨🇦', AU: '🇦🇺', DE: '🇩🇪', FR: '🇫🇷', ES: '🇪🇸', IT: '🇮🇹',
  BR: '🇧🇷', MX: '🇲🇽', IN: '🇮🇳', JP: '🇯🇵', KR: '🇰🇷', NL: '🇳🇱', SE: '🇸🇪', NO: '🇳🇴',
  DK: '🇩🇰', FI: '🇫🇮', PL: '🇵🇱', PT: '🇵🇹', AR: '🇦🇷', CO: '🇨🇴', CL: '🇨🇱', PH: '🇵🇭',
  NG: '🇳🇬', ZA: '🇿🇦', EG: '🇪🇬', AE: '🇦🇪', SA: '🇸🇦', SG: '🇸🇬', MY: '🇲🇾', ID: '🇮🇩',
  TH: '🇹🇭', VN: '🇻🇳', PK: '🇵🇰', BD: '🇧🇩', TR: '🇹🇷', RU: '🇷🇺', UA: '🇺🇦', CH: '🇨🇭',
  AT: '🇦🇹', BE: '🇧🇪', NZ: '🇳🇿', IL: '🇮🇱', GH: '🇬🇭', KE: '🇰🇪', TZ: '🇹🇿', ET: '🇪🇹',
}

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia', DE: 'Germany',
  FR: 'France', ES: 'Spain', IT: 'Italy', BR: 'Brazil', MX: 'Mexico', IN: 'India',
  JP: 'Japan', KR: 'South Korea', NL: 'Netherlands', SE: 'Sweden', NO: 'Norway',
  DK: 'Denmark', FI: 'Finland', PL: 'Poland', PT: 'Portugal', AR: 'Argentina',
  CO: 'Colombia', CL: 'Chile', PH: 'Philippines', NG: 'Nigeria', ZA: 'South Africa',
  EG: 'Egypt', AE: 'UAE', SA: 'Saudi Arabia', SG: 'Singapore', MY: 'Malaysia',
  ID: 'Indonesia', TH: 'Thailand', VN: 'Vietnam', PK: 'Pakistan', BD: 'Bangladesh',
  TR: 'Turkey', RU: 'Russia', UA: 'Ukraine', CH: 'Switzerland', AT: 'Austria',
  BE: 'Belgium', NZ: 'New Zealand', IL: 'Israel', GH: 'Ghana', KE: 'Kenya',
  TZ: 'Tanzania', ET: 'Ethiopia',
}

const PLAN_COLOR: Record<string, string> = {
  free: 'bg-neutral-200 text-neutral-700',
  pro: 'bg-blue-100 text-blue-700',
  agency: 'bg-purple-100 text-purple-700',
  max: 'bg-amber-100 text-amber-700',
}

const SOURCE_COLOR: Record<string, string> = {
  tiktok: 'bg-pink-500',
  instagram: 'bg-orange-500',
  youtube: 'bg-red-500',
  twitter: 'bg-sky-500',
  x: 'bg-sky-500',
  direct: 'bg-neutral-400',
}

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color: string
}) {
  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{label}</p>
        <p className="text-2xl font-bold text-neutral-900 dark:text-white">{value}</p>
        {sub && <p className="text-xs text-neutral-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function ConversionBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-neutral-600 dark:text-neutral-400">{label}</span>
        <span className="font-semibold text-neutral-900 dark:text-white">{pct}%</span>
      </div>
      <div className="h-2 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  )
}

function SignupsChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1)
  return (
    <div className="flex items-end gap-px h-24 w-full">
      {data.map((d) => (
        <div key={d.date} className="flex-1 relative group flex flex-col justify-end h-full">
          <div
            className="w-full bg-blue-500 dark:bg-blue-400 rounded-sm hover:bg-blue-600 dark:hover:bg-blue-300 transition-colors"
            style={{ height: `${Math.max((d.count / max) * 100, d.count > 0 ? 4 : 0)}%` }}
          />
          <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-neutral-900 text-white text-xs px-1.5 py-0.5 rounded whitespace-nowrap z-10 pointer-events-none">
            {d.date.slice(5)}: {d.count}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function AdminPage() {
  const router = useRouter()
  const [period, setPeriod] = useState<Period>('today')
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [clones, setClones] = useState<CloneActivity[]>([])
  const [cloneFilter, setCloneFilter] = useState<'all' | 'complete' | 'error'>('all')
  const [searchEmail, setSearchEmail] = useState('')
  const [searchResult, setSearchResult] = useState<{ email: string; plan: string; clones_count: number; tokens_used: number } | null>(null)
  const [changingPlan, setChangingPlan] = useState(false)

  const fetchStats = useCallback(async (p: Period) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/stats?period=${p}&_t=${Date.now()}`, { cache: 'no-store' })
      if (res.status === 401 || res.status === 403) { router.push('/dashboard'); return }
      if (!res.ok) throw new Error('Failed to load stats')
      setStats(await res.json())
    } catch {
      setError('Failed to load stats')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { fetchStats(period) }, [period, fetchStats])

  useEffect(() => {
    const status = cloneFilter === 'all' ? '' : `&status=${cloneFilter}`
    fetch(`/api/admin/clones?limit=100${status}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setClones(d))
      .catch(() => {})
  }, [cloneFilter])

  const handlePeriodChange = (p: Period) => {
    setPeriod(p)
  }

  const handleSearch = async () => {
    if (!searchEmail.trim()) return
    const res = await fetch(`/api/admin/user?email=${encodeURIComponent(searchEmail.trim())}`)
    if (res.ok) setSearchResult(await res.json())
    else setSearchResult(null)
  }

  const handlePlanChange = async (plan: string) => {
    if (!searchResult) return
    setChangingPlan(true)
    await fetch('/api/admin/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: searchResult.email, plan }),
    })
    setSearchResult({ ...searchResult, plan })
    setChangingPlan(false)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <div className="w-8 h-8 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
      <p className="text-red-500">{error}</p>
    </div>
  )

  if (!stats) return null

  const freeCount = stats.users.plans.free ?? 0
  const proCount = stats.users.plans.pro ?? 0
  const agencyCount = stats.users.plans.agency ?? 0
  const maxCount = stats.users.plans.max ?? 0
  const periodLabel = PERIOD_LABELS[period]

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Admin Dashboard</h1>
            <p className="text-sm text-neutral-500 mt-0.5">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Period selector */}
            <div className="flex bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-1 gap-1">
              {(['today', 'yesterday', '7d', '30d'] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => handlePeriodChange(p)}
                  className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                    period === p
                      ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900'
                      : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  {p === 'today' ? 'Today' : p === 'yesterday' ? 'Yesterday' : p === '7d' ? '7 Days' : '30 Days'}
                </button>
              ))}
            </div>
            <button
              onClick={() => fetchStats(period)}
              className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white px-3 py-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard
            icon={Users}
            label="Total Users"
            value={stats.users.total.toLocaleString()}
            sub={`+${stats.users.thisPeriod} ${periodLabel.toLowerCase()}`}
            color="bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400"
          />
          <StatCard
            icon={DollarSign}
            label="Est. MRR"
            value={`$${stats.users.mrr.toLocaleString()}`}
            sub={`${stats.users.paid} paid users`}
            color="bg-green-50 text-green-600 dark:bg-green-950/50 dark:text-green-400"
          />
          <StatCard
            icon={TrendingUp}
            label="New Signups"
            value={stats.users.thisPeriod}
            sub={periodLabel}
            color="bg-purple-50 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400"
          />
          <StatCard
            icon={Copy}
            label="Clones"
            value={stats.clones.thisPeriod}
            sub={`${stats.clones.total.toLocaleString()} all-time`}
            color="bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400"
          />
          <StatCard
            icon={Globe}
            label="Visitors"
            value={stats.traffic.visitorsPeriod}
            sub={`${stats.traffic.visitorsToday} today`}
            color="bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400"
          />
        </div>

        {/* Signups Chart */}
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-500" />
              <h2 className="font-semibold text-neutral-900 dark:text-white">New Signups — Last 30 Days</h2>
            </div>
            <span className="text-sm text-neutral-400">{stats.users.total.toLocaleString()} total</span>
          </div>
          <SignupsChart data={stats.chartData} />
          <div className="flex justify-between mt-2 text-xs text-neutral-400">
            <span>{stats.chartData[0]?.date.slice(5)}</span>
            <span>{stats.chartData[stats.chartData.length - 1]?.date.slice(5)}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Conversion Funnel */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <h2 className="font-semibold text-neutral-900 dark:text-white">Conversion Funnel</h2>
            </div>
            <ConversionBar label={`Visit → Signup (${periodLabel})`} pct={stats.conversions.visitToSignup} color="bg-blue-500" />
            <ConversionBar label="Signup → Paid (all-time)" pct={stats.conversions.signupToPaid} color="bg-green-500" />
            <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 grid grid-cols-4 gap-2 text-center">
              <div>
                <p className="text-xs text-neutral-400">Free</p>
                <p className="text-lg font-bold text-neutral-900 dark:text-white">{freeCount}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-400">Pro</p>
                <p className="text-lg font-bold text-blue-600">{proCount}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-400">Agency</p>
                <p className="text-lg font-bold text-purple-600">{agencyCount}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-400">Max</p>
                <p className="text-lg font-bold text-amber-600">{maxCount}</p>
              </div>
            </div>
          </div>

          {/* Signups by Source — attributed via the user's first page_view utm */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-green-500" />
              <h2 className="font-semibold text-neutral-900 dark:text-white">Signups by Source</h2>
              <span className="text-xs text-neutral-400 ml-auto">{periodLabel}</span>
            </div>
            {!stats.traffic.signupSources || stats.traffic.signupSources.length === 0 ? (
              <p className="text-sm text-neutral-400 text-center py-6">No attributed signups yet.<br />Users sign up but their landing didn&apos;t carry a UTM tag.</p>
            ) : (
              <div className="space-y-3">
                {stats.traffic.signupSources.map((s) => (
                  <div key={s.source}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="capitalize text-neutral-700 dark:text-neutral-300">{s.source}</span>
                      <span className="text-neutral-500">{s.count} · {s.pct}%</span>
                    </div>
                    <div className="h-2 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${SOURCE_COLOR[s.source.toLowerCase()] ?? 'bg-green-500'}`}
                        style={{ width: `${s.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Traffic by Source — every visitor page_view with utm_source */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-purple-500" />
              <h2 className="font-semibold text-neutral-900 dark:text-white">Traffic by Source</h2>
              <span className="text-xs text-neutral-400 ml-auto">{periodLabel}</span>
            </div>
            {stats.traffic.sources.length === 0 ? (
              <p className="text-sm text-neutral-400 text-center py-6">No UTM traffic yet.<br />Add ?utm_source=tiktok to your links.</p>
            ) : (
              <div className="space-y-3">
                {stats.traffic.sources.map((s) => (
                  <div key={s.source}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="capitalize text-neutral-700 dark:text-neutral-300">{s.source}</span>
                      <span className="text-neutral-500">{s.count} · {s.pct}%</span>
                    </div>
                    <div className="h-2 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${SOURCE_COLOR[s.source.toLowerCase()] ?? 'bg-neutral-500'}`}
                        style={{ width: `${s.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Traffic by Country */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-500" />
              <h2 className="font-semibold text-neutral-900 dark:text-white">Traffic by Country</h2>
              <span className="text-xs text-neutral-400 ml-auto">{periodLabel}</span>
            </div>
            {!stats.traffic.countries || stats.traffic.countries.length === 0 ? (
              <p className="text-sm text-neutral-400 text-center py-6">No country data yet.<br />Will populate as visitors come in.</p>
            ) : (
              <div className="space-y-2 overflow-y-auto max-h-72">
                {(() => {
                  const total = stats.traffic.countries.reduce((s, c) => s + c.count, 0)
                  return stats.traffic.countries.map((c) => (
                    <div key={c.country}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-neutral-700 dark:text-neutral-300">
                          {FLAG_EMOJI[c.country] ?? '🌐'} {COUNTRY_NAMES[c.country] ?? c.country}
                        </span>
                        <span className="text-neutral-500">{c.count} · {total > 0 ? Math.round((c.count / total) * 100) : 0}%</span>
                      </div>
                      <div className="h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-400 rounded-full"
                          style={{ width: `${total > 0 ? Math.round((c.count / total) * 100) : 0}%` }}
                        />
                      </div>
                    </div>
                  ))
                })()}
              </div>
            )}
          </div>

          {/* Recent Signups */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-green-500" />
              <h2 className="font-semibold text-neutral-900 dark:text-white">Recent Signups</h2>
              <span className="text-xs text-neutral-400 ml-auto">{periodLabel}</span>
            </div>
            <div className="space-y-2 overflow-y-auto max-h-64">
              {stats.recentUsers.length === 0 ? (
                <p className="text-sm text-neutral-400 text-center py-4">No signups this period</p>
              ) : stats.recentUsers.map((u) => (
                <div key={u.email + u.created_at} className="py-1.5 border-b border-neutral-50 dark:border-neutral-800/50 last:border-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-sm text-neutral-800 dark:text-neutral-200 truncate">{u.email}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ml-2 flex-shrink-0 ${PLAN_COLOR[u.plan] ?? 'bg-neutral-100 text-neutral-600'}`}>
                      {u.plan}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-neutral-400">
                    <span>{timeAgo(u.created_at)}</span>
                    <span>{u.clones_count ?? 0} clone{(u.clones_count ?? 0) !== 1 ? 's' : ''}</span>
                    <span className={(u.tokens_used ?? 0) > 0 ? 'text-blue-500 font-medium' : ''}>{(u.tokens_used ?? 0).toLocaleString()} tokens</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Users by Usage */}
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-blue-500" />
            <h2 className="font-semibold text-neutral-900 dark:text-white">Top Users by Token Usage</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="text-left py-2 text-neutral-400 font-medium">Email</th>
                  <th className="text-left py-2 text-neutral-400 font-medium">Plan</th>
                  <th className="text-right py-2 text-neutral-400 font-medium">Tokens Used</th>
                  <th className="text-right py-2 text-neutral-400 font-medium">Clones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/50">
                {stats.topUsers.map((u) => (
                  <tr key={u.email}>
                    <td className="py-2 text-neutral-800 dark:text-neutral-200 truncate max-w-xs">{u.email}</td>
                    <td className="py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PLAN_COLOR[u.plan] ?? 'bg-neutral-100'}`}>
                        {u.plan}
                      </span>
                    </td>
                    <td className="py-2 text-right text-neutral-600 dark:text-neutral-400 font-mono">{(u.tokens_used ?? 0).toLocaleString()}</td>
                    <td className="py-2 text-right text-neutral-600 dark:text-neutral-400">{u.clones_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Paid Users */}
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-green-500" />
            <h2 className="font-semibold text-neutral-900 dark:text-white">Paid Users</h2>
            <span className="text-xs text-neutral-400 ml-auto">Est. MRR: ${stats.users.mrr}/mo</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="text-left py-2 text-neutral-400 font-medium">Email</th>
                  <th className="text-left py-2 text-neutral-400 font-medium">Plan</th>
                  <th className="text-right py-2 text-neutral-400 font-medium">Tokens Used</th>
                  <th className="text-right py-2 text-neutral-400 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/50">
                {stats.allPaidUsers.map((u) => (
                  <tr key={u.email + u.created_at}>
                    <td className="py-2 text-neutral-800 dark:text-neutral-200">{u.email}</td>
                    <td className="py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PLAN_COLOR[u.plan] ?? 'bg-neutral-100'}`}>
                        {u.plan}
                      </span>
                    </td>
                    <td className="py-2 text-right text-neutral-500 font-mono">{(u.tokens_used ?? 0).toLocaleString()}</td>
                    <td className="py-2 text-right text-neutral-400">{timeAgo(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Clone Activity */}
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Copy className="w-4 h-4 text-orange-500" />
              <h2 className="font-semibold text-neutral-900 dark:text-white">Clone Activity</h2>
              <span className="text-xs text-neutral-400">
                {clones.filter(c => c.status === 'complete').length} ok · {clones.filter(c => c.status === 'error').length} failed
              </span>
            </div>
            <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-lg p-1 gap-1">
              {(['all', 'complete', 'error'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setCloneFilter(f)}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-colors capitalize ${
                    cloneFilter === f
                      ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="text-left py-2 text-neutral-400 font-medium">Status</th>
                  <th className="text-left py-2 text-neutral-400 font-medium">URL Cloned</th>
                  <th className="text-left py-2 text-neutral-400 font-medium">User</th>
                  <th className="text-right py-2 text-neutral-400 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/50">
                {clones.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                    onClick={() => window.open(`/preview/${c.id}`, '_blank')}
                    title="Open clone preview in new tab"
                  >
                    <td className="py-2">
                      {c.status === 'complete' && <CheckCircle className="w-4 h-4 text-green-500" />}
                      {c.status === 'error' && <XCircle className="w-4 h-4 text-red-500" />}
                      {c.status === 'pending' && <Clock className="w-4 h-4 text-yellow-500" />}
                    </td>
                    <td className="py-2 max-w-xs">
                      <p className="text-neutral-800 dark:text-neutral-200 truncate font-medium">{c.name}</p>
                      <p className="text-xs text-neutral-400 truncate">{c.url}</p>
                    </td>
                    <td className="py-2">
                      <p className="text-neutral-700 dark:text-neutral-300 truncate max-w-[200px]">{c.email}</p>
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${PLAN_COLOR[c.plan] ?? 'bg-neutral-100 text-neutral-600'}`}>{c.plan}</span>
                    </td>
                    <td className="py-2 text-right text-neutral-400 whitespace-nowrap">{timeAgo(c.created_at)}</td>
                  </tr>
                ))}
                {clones.length === 0 && (
                  <tr><td colSpan={4} className="py-8 text-center text-neutral-400 text-sm">No clones yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* User Management */}
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-500" />
            <h2 className="font-semibold text-neutral-900 dark:text-white">User Management</h2>
          </div>
          <div className="flex gap-2">
            <input
              type="email"
              placeholder="Search by email..."
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1 px-3 py-2 text-sm border border-neutral-200 dark:border-neutral-700 rounded-lg bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSearch}
              className="px-4 py-2 text-sm bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-lg hover:opacity-90 transition-opacity font-medium"
            >
              Search
            </button>
          </div>
          {searchResult && (
            <div className="border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-neutral-900 dark:text-white">{searchResult.email}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    {searchResult.clones_count} clones · {(searchResult.tokens_used ?? 0).toLocaleString()} tokens used
                  </p>
                </div>
                <span className={`text-sm font-medium px-3 py-1 rounded-full ${PLAN_COLOR[searchResult.plan] ?? 'bg-neutral-100'}`}>
                  {searchResult.plan}
                </span>
              </div>
              <div className="flex gap-2">
                {['free', 'pro', 'agency', 'max'].map((p) => (
                  <button
                    key={p}
                    disabled={changingPlan || searchResult.plan === p}
                    onClick={() => handlePlanChange(p)}
                    className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                      searchResult.plan === p
                        ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400 cursor-default'
                        : 'border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    {changingPlan && searchResult.plan !== p ? '...' : `Set ${p}`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
