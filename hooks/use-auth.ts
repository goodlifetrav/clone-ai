'use client'

import { useEffect, useState } from 'react'

interface AuthUser {
  id: string
  email: string
  name: string
  plan: string
  is_admin: boolean
  tokens_used: number
  clones_count: number
  free_chats_used: number
}

interface AuthState {
  user: AuthUser | null
  isLoaded: boolean
  isSignedIn: boolean
}

let cache: AuthState | null = null

export function useAuth(): AuthState & { signOut: () => void } {
  const [state, setState] = useState<AuthState>(
    cache ?? { user: null, isLoaded: false, isSignedIn: false }
  )

  useEffect(() => {
    if (cache?.isLoaded) {
      setState(cache)
      return
    }

    fetch('/api/user')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const next: AuthState = data
          ? { user: data, isLoaded: true, isSignedIn: true }
          : { user: null, isLoaded: true, isSignedIn: false }
        cache = next
        setState(next)
      })
      .catch(() => {
        const next: AuthState = { user: null, isLoaded: true, isSignedIn: false }
        cache = next
        setState(next)
      })
  }, [])

  function signOut() {
    cache = null
    window.location.href = '/api/auth/whop/logout'
  }

  return { ...state, signOut }
}
