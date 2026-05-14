'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Header } from '@/components/header'
import { cn } from '@/lib/utils'
import { BookOpen, Zap, Globe, CreditCard, HelpCircle, ChevronRight, ShoppingBag } from 'lucide-react'

const NAV = [
  {
    label: 'Getting Started',
    href: '/docs/getting-started',
    icon: BookOpen,
  },
  {
    label: 'AI Editor',
    href: '/docs/ai-editor',
    icon: Zap,
  },
  {
    label: 'Custom Domains',
    href: '/docs/custom-domains',
    icon: Globe,
  },
  {
    label: 'Shopify Integration',
    href: '/docs/shopify-integration',
    icon: ShoppingBag,
  },
  {
    label: 'Plans & Tokens',
    href: '/docs/plans-tokens',
    icon: CreditCard,
  },
  {
    label: 'FAQ',
    href: '/docs/faq',
    icon: HelpCircle,
  },
]

function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-60 flex-shrink-0">
      <div className="sticky top-24">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-3 px-2">
          Documentation
        </p>
        <nav className="space-y-0.5">
          {NAV.map(({ label, href, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm transition-colors',
                  active
                    ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-medium'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
                {active && <ChevronRight className="w-3 h-3 ml-auto" />}
              </Link>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <Header />
      <div className="pt-20 max-w-5xl mx-auto px-4 pb-24">
        {/* Mobile nav — above content, below header */}
        <div className="md:hidden mt-6">
          <MobileNav />
        </div>

        <div className="flex gap-12 mt-8">
          {/* Sidebar — hidden on mobile, visible on md+ */}
          <div className="hidden md:block">
            <Sidebar />
          </div>

          {/* Content */}
          <main className="flex-1 min-w-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_li]:text-[15px] [&_li]:text-neutral-600 [&_li]:dark:text-neutral-300 [&_code]:font-mono [&_code]:text-sm [&_code]:bg-neutral-100 [&_code]:dark:bg-neutral-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_strong]:text-neutral-900 [&_strong]:dark:text-white [&_em]:italic">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}

function MobileNav() {
  const pathname = usePathname()
  const current = NAV.find((n) => n.href === pathname)

  return (
    <div className="md:hidden w-full mb-6">
      <select
        className="w-full h-9 text-sm px-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white"
        value={pathname}
        onChange={(e) => {
          window.location.href = e.target.value
        }}
      >
        {NAV.map(({ label, href }) => (
          <option key={href} value={href}>
            {label}
          </option>
        ))}
      </select>
    </div>
  )
}
