'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, Loader2, Zap } from 'lucide-react'
import { useUser, useClerk } from '@clerk/nextjs'
import type { Plan } from '@/types'
import { cn } from '@/lib/utils'

interface PricingPlan {
  id: Plan
  name: string
  price: number
  priceId?: string
  tokens: string
  description: string
  features: string[]
  highlighted?: boolean
}

const PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    tokens: '10K',
    description: 'Get started for free',
    features: [
      '1 website clone',
      '10,000 AI tokens',
      'Live preview',
      'AI chat assistant',
      'Community support',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 10,
    tokens: '40K',
    description: 'For personal projects',
    features: [
      'Unlimited clones',
      '40,000 AI tokens/month',
      'Download as ZIP',
      'Fork projects',
      'Version history',
      'Priority support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 25,
    tokens: '100K',
    description: 'For professionals',
    highlighted: true,
    features: [
      'Everything in Starter',
      '100,000 AI tokens/month',
      'Deploy to Vercel',
      'GitHub integration',
      'Visual editor',
      'Terminal panel',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 50,
    tokens: '200K',
    description: 'For growing teams',
    features: [
      'Everything in Pro',
      '200,000 AI tokens/month',
      'Shopify integration',
      'Team collaboration',
      'Custom domains',
      'Priority AI queue',
    ],
  },
  {
    id: 'max',
    name: 'Max',
    price: 100,
    tokens: '400K',
    description: 'For power users',
    features: [
      'Everything in Growth',
      '400,000 AI tokens/month',
      'Dedicated support',
      'SLA guarantee',
      'Custom integrations',
      'White-label option',
    ],
  },
]

export function PricingCards({ currentPlan }: { currentPlan?: Plan }) {
  const [loading, setLoading] = useState<Plan | null>(null)
  const { isSignedIn } = useUser()
  const { openSignIn } = useClerk()

  const handleUpgrade = async (plan: Plan) => {
    if (plan === 'free') return

    if (!isSignedIn) {
      openSignIn()
      return
    }

    setLoading(plan)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || 'Failed to start checkout. Please try again.')
        return
      }
      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      alert('Failed to start checkout. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 w-full">
      {PLANS.map((plan) => {
        const isCurrent = currentPlan === plan.id
        const isHighlighted = plan.highlighted

        return (
          <div
            key={plan.id}
            className={cn(
              'relative rounded-2xl border p-6 flex flex-col',
              isHighlighted
                ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900 shadow-xl scale-[1.02]'
                : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
            )}
          >
            {isHighlighted && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-white text-neutral-900 dark:bg-neutral-900 dark:text-white border-0 shadow px-3">
                  <Zap className="w-3 h-3 mr-1" />
                  Most Popular
                </Badge>
              </div>
            )}

            {/* Plan info */}
            <div className="mb-6">
              <h3
                className={cn(
                  'font-bold text-lg',
                  isHighlighted ? 'text-white dark:text-neutral-900' : 'text-neutral-900 dark:text-white'
                )}
              >
                {plan.name}
              </h3>
              <p
                className={cn(
                  'text-sm mt-0.5',
                  isHighlighted ? 'text-neutral-300 dark:text-neutral-600' : 'text-neutral-500 dark:text-neutral-400'
                )}
              >
                {plan.description}
              </p>
              <div className="mt-4 flex items-baseline gap-1">
                <span
                  className={cn(
                    'text-4xl font-bold',
                    isHighlighted ? 'text-white dark:text-neutral-900' : 'text-neutral-900 dark:text-white'
                  )}
                >
                  ${plan.price}
                </span>
                {plan.price > 0 && (
                  <span
                    className={cn(
                      'text-sm',
                      isHighlighted ? 'text-neutral-400 dark:text-neutral-500' : 'text-neutral-500 dark:text-neutral-400'
                    )}
                  >
                    /month
                  </span>
                )}
              </div>
              <div
                className={cn(
                  'text-xs mt-1 font-medium',
                  isHighlighted ? 'text-neutral-300 dark:text-neutral-600' : 'text-neutral-400 dark:text-neutral-500'
                )}
              >
                {plan.tokens} AI tokens
              </div>
            </div>

            {/* Features */}
            <ul className="space-y-2.5 flex-1 mb-6">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check
                    className={cn(
                      'w-4 h-4 flex-shrink-0 mt-0.5',
                      isHighlighted ? 'text-white dark:text-neutral-900' : 'text-neutral-500 dark:text-neutral-400'
                    )}
                  />
                  <span
                    className={cn(
                      isHighlighted ? 'text-neutral-200 dark:text-neutral-700' : 'text-neutral-600 dark:text-neutral-300'
                    )}
                  >
                    {feature}
                  </span>
                </li>
              ))}
            </ul>

            {/* CTA */}
            {isCurrent ? (
              <Button
                disabled
                className={cn(
                  'w-full',
                  isHighlighted
                    ? 'bg-white/20 text-white border-white/30 hover:bg-white/20 dark:bg-neutral-900/20 dark:text-neutral-900'
                    : ''
                )}
                variant={isHighlighted ? 'outline' : 'secondary'}
              >
                Current Plan
              </Button>
            ) : plan.id === 'free' ? (
              <Button
                variant={isHighlighted ? 'secondary' : 'outline'}
                className="w-full"
                onClick={() => !isSignedIn && openSignIn()}
              >
                Get Started Free
              </Button>
            ) : (
              <Button
                className={cn(
                  'w-full',
                  isHighlighted
                    ? 'bg-white text-neutral-900 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-white dark:hover:bg-neutral-800'
                    : ''
                )}
                variant={isHighlighted ? 'secondary' : 'default'}
                onClick={() => handleUpgrade(plan.id)}
                disabled={loading === plan.id}
              >
                {loading === plan.id ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Upgrade to {plan.name}
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
