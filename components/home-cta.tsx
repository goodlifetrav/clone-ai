'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'

export function HomeCta() {
  const { isLoaded, isSignedIn } = useAuth()

  // Until auth resolves, render a neutral placeholder so the hero doesn't
  // flash between two CTA states. Same dimensions as the real button.
  if (!isLoaded) {
    return (
      <div className="h-14 w-56 rounded-xl bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
    )
  }

  if (isSignedIn) {
    return (
      <Button asChild size="lg" className="h-14 px-8 text-base font-semibold rounded-xl">
        <Link href="/dashboard">
          Go to Dashboard
          <ArrowRight className="ml-2 w-5 h-5" />
        </Link>
      </Button>
    )
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
