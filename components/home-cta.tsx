'use client'

import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { UrlInput } from '@/components/url-input'

export function HomeCta() {
  const { isLoaded, isSignedIn } = useAuth()

  // Until auth resolves, render a neutral placeholder so the hero doesn't
  // flash between two CTA states.
  if (!isLoaded) {
    return (
      <div className="h-14 w-full max-w-2xl rounded-xl bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
    )
  }

  // Signed-in users skip the marketing CTA and go straight to the URL
  // input — same component the dashboard uses, so behaviour stays consistent.
  if (isSignedIn) {
    return <UrlInput />
  }

  return (
    <Button
      size="lg"
      className="h-14 px-8 text-base font-semibold rounded-xl"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent('open-auth-modal', {
            detail: { next: '/dashboard', mode: 'sign-up' },
          })
        )
      }}
    >
      Get Started
      <ArrowRight className="ml-2 w-5 h-5" />
    </Button>
  )
}
