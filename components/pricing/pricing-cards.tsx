'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, Loader2, Zap } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import type { Plan } from '@/types'
import { cn } from '@/lib/utils'

type BillingPeriod = 'monthly' | 'annual'

interface PricingPlan {
  id: Plan
  name: string
  monthlyPrice: number
  annualPrice: number
  description: string
  features: string[]
  highlighted?: boolean
}

const PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    monthlyPrice: 0,
    annualPrice: 0,
    description: 'Get started for free',
    features: [
      '1 page clone',
      '75K AI tokens',
      'Live preview',
      'Download ZIP',
      'Community support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 19,
    annualPrice: 15,
    description: 'For professionals',
    highlighted: true,
    features: [
      '20 page clones/month',
      '2M AI tokens/month',
      'AI Brand Rebuild',
      'Version history',
      'Custom domain',
      'Hosting',
      'Priority support',
      'Buy extra tokens',
    ],
  },
  {
    id: 'agency',
    name: 'Agency',
    monthlyPrice: 49,
    annualPrice: 39,
    description: 'For teams and agencies',
    features: [
      'Everything in Pro',
      '60 page clones/month',
      '6M AI tokens/month',
      'Priority support',
      'Buy extra tokens',
    ],
  },
]

export function PricingCards({ currentPlan }: { currentPlan?: Plan }) {
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly')
  const [loading, setLoading] = useState<Plan | null>(null)
  const { isSignedIn, signIn } = useAuth()

  const handleUpgrade = async (plan: Plan) => {
    if (plan === 'free') return

    if (!isSignedIn) {
      signIn('/pricing')
      return
    }

    setLoading(plan)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, billingPeriod }),
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
    <div className="flex flex-col items-center gap-10">
      {/* Billing toggle */}
      <div className="flex items-center gap-3 p-1 rounded-full bg-neutral-100 dark:bg-neutral-800">
        <button
          onClick={() => setBillingPeriod('monthly')}
          className={cn(
            'px-5 py-1.5 rounded-full text-sm font-medium transition-colors',
            billingPeriod === 'monthly'
              ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-sm'
              : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
          )}
        >
          Monthly
        </button>
        <button
          onClick={() => setBillingPeriod('annual')}
          className={cn(
            'px-5 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-2',
            billingPeriod === 'annual'
              ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-sm'
              : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
          )}
        >
          Annual
          <span className="text-xs font-semibold text-green-600 dark:text-green-400">20% off</span>
        </button>
      </div>

      {billingPeriod === 'annual' && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400 -mt-6">
          Billed annually
        </p>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.id
          const isHighlighted = plan.highlighted
          const price = billingPeriod === 'annual' ? plan.annualPrice : plan.monthlyPrice

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
                    ${price}
                  </span>
                  {price > 0 && (
                    <span
                      className={cn(
                        'text-sm',
                        isHighlighted ? 'text-neutral-400 dark:text-neutral-500' : 'text-neutral-500 dark:text-neutral-400'
                      )}
                    >
                      /mo
                    </span>
                  )}
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
                  variant="outline"
                  className="w-full"
                  onClick={() => !isSignedIn && signIn()}
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
                  {loading === plan.id && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Upgrade to {plan.name}
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
