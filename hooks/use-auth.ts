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

  // Listen for popup auth success
  useEffect(() => {
    const appUrl = window.location.origin
    function onMessage(e: MessageEvent) {
      if (e.origin !== appUrl) return
      if (e.data?.type === 'igualai_auth_success') {
        cache = null
        fetchAuthState().then((next) => {
          cache = next
          setState(next)
          const next_path = e.data.next as string | undefined
          if (next_path && next_path !== '/dashboard') {
            window.location.href = next_path
          }
        })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const signIn = useCallback((next?: string) => {
    const params = new URLSearchParams({ popup: '1' })
    if (next) params.set('next', next)
    const url = `/sign-in?${params.toString()}`
    const w = 500
    const h = 650
    const left = window.screenX + (window.outerWidth - w) / 2
    const top = window.screenY + (window.outerHeight - h) / 2
    window.open(url, 'igualai_login', `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`)
  }, [])

  function signOut() {
    cache = null
    window.location.href = '/api/auth/logout'
  }

  return { ...state, signIn, signOut }
}
