'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Users, TrendingUp, Globe, Zap, Clone, ArrowUpRight, RefreshCw } from 'lucide-react'

interface Stats {
  users: { total: number; today: number; thisWeek: number; plans: Record<string, number>; paid: number }
  clones: { total: number; thisWeek: number }
  traffic: { pageViewsToday: number; pageViewsThisWeek: number; sources: { source: string; count: number; pct: number }[] }
  conversions: { visitToSignup: number; signupToPaid: number }
  recentUsers: { email: string; plan: string; created_at: string }[]
  recentUpgrades: { email: string; plan: string; created_at: string }[]
}

const PLAN_COLOR: Record<string, string> = {
  free: 'bg-neutral-200 text-neutral-700',
  pro: 'bg-blue-100 text-blue-700',
  agency: 'bg-purple-100 text-purple-700',
}

const SOURCE_COLOR: Record<string, string> = {
  tiktok: 'bg-pink-500',
  instagram: 'bg-orange-500',
  youtube: 'bg-red-500',
  twitter: 'bg-sky-500',
  direct: 'bg-neutral-400',
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

export default function AdminPage() {
  const router = useRouter()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchEmail, setSearchEmail] = useState('')
  const [searchResult, setSearchResult] = useState<{ email: string; plan: string; clones_count: number; tokens_used: number } | null>(null)
  const [changingPlan, setChangingPlan] = useState(false)

  const fetchStats = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/stats')
      if (res.status === 401 || res.status === 403) { router.push('/dashboard'); return }
      if (!res.ok) throw new Error('Failed to load stats')
      setStats(await res.json())
    } catch (e) {
      setError('Failed to load stats')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchStats() }, [])

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

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Admin Dashboard</h1>
            <p className="text-sm text-neutral-500 mt-0.5">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
          <button
            onClick={fetchStats}
            className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white px-3 py-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Users} label="Total Users" value={stats.users.total} sub={`+${stats.users.today} today`} color="bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400" />
          <StatCard icon={TrendingUp} label="Paid Users" value={stats.users.paid} sub={`${proCount} pro · ${agencyCount} agency`} color="bg-green-50 text-green-600 dark:bg-green-950/50 dark:text-green-400" />
          <StatCard icon={Globe} label="Visits Today" value={stats.traffic.pageViewsToday} sub={`${stats.traffic.pageViewsThisWeek} this week`} color="bg-purple-50 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400" />
          <StatCard icon={Clone} label="Clones Total" value={stats.clones.total} sub={`${stats.clones.thisWeek} this week`} color="bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Conversion Funnel */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <h2 className="font-semibold text-neutral-900 dark:text-white">Conversion Funnel</h2>
            </div>
            <ConversionBar label="Visit → Signup (7d)" pct={stats.conversions.visitToSignup} color="bg-blue-500" />
            <ConversionBar label="Signup → Paid (all-time)" pct={stats.conversions.signupToPaid} color="bg-green-500" />
            <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 grid grid-cols-3 gap-3 text-center">
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
            </div>
          </div>

          {/* Traffic Sources */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-purple-500" />
              <h2 className="font-semibold text-neutral-900 dark:text-white">Traffic Sources</h2>
              <span className="text-xs text-neutral-400 ml-auto">7 days</span>
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

          {/* Signups This Week */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-green-500" />
              <h2 className="font-semibold text-neutral-900 dark:text-white">Recent Signups</h2>
            </div>
            <div className="space-y-2">
              {stats.recentUsers.map((u) => (
                <div key={u.email} className="flex items-center justify-between py-1">
                  <div className="min-w-0">
                    <p className="text-sm text-neutral-800 dark:text-neutral-200 truncate">{u.email}</p>
                    <p className="text-xs text-neutral-400">{timeAgo(u.created_at)}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ml-2 flex-shrink-0 ${PLAN_COLOR[u.plan] ?? 'bg-neutral-100 text-neutral-600'}`}>
                    {u.plan}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Upgrades */}
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-green-500" />
            <h2 className="font-semibold text-neutral-900 dark:text-white">Paid Users</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="text-left py-2 text-neutral-400 font-medium">Email</th>
                  <th className="text-left py-2 text-neutral-400 font-medium">Plan</th>
                  <th className="text-left py-2 text-neutral-400 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800/50">
                {stats.recentUpgrades.map((u) => (
                  <tr key={u.email}>
                    <td className="py-2 text-neutral-800 dark:text-neutral-200">{u.email}</td>
                    <td className="py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PLAN_COLOR[u.plan] ?? 'bg-neutral-100'}`}>
                        {u.plan}
                      </span>
                    </td>
                    <td className="py-2 text-neutral-400">{timeAgo(u.created_at)}</td>
                  </tr>
                ))}
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
                    {searchResult.clones_count} clones · {searchResult.tokens_used.toLocaleString()} tokens used
                  </p>
                </div>
                <span className={`text-sm font-medium px-3 py-1 rounded-full ${PLAN_COLOR[searchResult.plan] ?? 'bg-neutral-100'}`}>
                  {searchResult.plan}
                </span>
              </div>
              <div className="flex gap-2">
                {['free', 'pro', 'agency'].map((p) => (
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
