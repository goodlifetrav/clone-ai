'use client'

import { useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Loader2, Zap } from 'lucide-react'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)

export default function AuthCallbackPage() {
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        window.location.href = '/?error=auth_failed'
        return
      }

      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: session.access_token }),
      })

      window.location.href = res.ok ? '/dashboard' : '/?error=auth_failed'
    })
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-neutral-900 dark:bg-white flex items-center justify-center">
          <Zap className="w-4 h-4 text-white dark:text-neutral-900" />
        </div>
        <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Signing you in...</p>
      </div>
    </div>
  )
}
