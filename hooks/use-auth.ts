'use client'

import { useEffect, useState, useCallback } from 'react'

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

async function fetchAuthState(): Promise<AuthState> {
  try {
    const res = await fetch('/api/user')
    if (!res.ok) return { user: null, isLoaded: true, isSignedIn: false }
    const data = await res.json()
    return { user: data, isLoaded: true, isSignedIn: true }
  } catch {
    return { user: null, isLoaded: true, isSignedIn: false }
  }
}

export function useAuth(): AuthState & { signIn: (next?: string) => void; signOut: () => void } {
  const [state, setState] = useState<AuthState>(
    cache ?? { user: null, isLoaded: false, isSignedIn: false }
  )

  useEffect(() => {
    if (cache?.isLoaded) {
      setState(cache)
      return
    }
    fetchAuthState().then((next) => {
      cache = next
      setState(next)
    })
  }, [])

  // Listen for modal auth success
  useEffect(() => {
    function onAuthSuccess(e: Event) {
      cache = null
      fetchAuthState().then((freshState) => {
        cache = freshState
        setState(freshState)
        const nextPath = (e as CustomEvent<{ next?: string }>).detail?.next
        if (nextPath && nextPath !== window.location.pathname) {
          window.location.href = nextPath
        }
      })
    }
    window.addEventListener('igualai_auth_success', onAuthSuccess)
    return () => window.removeEventListener('igualai_auth_success', onAuthSuccess)
  }, [])

  const signIn = useCallback((next?: string) => {
    window.dispatchEvent(
      new CustomEvent('open-auth-modal', { detail: { next: next ?? '/dashboard', mode: 'sign-in' } })
    )
  }, [])

  function signOut() {
    cache = null
    window.location.href = '/api/auth/logout'
  }

  return { ...state, signIn, signOut }
}
