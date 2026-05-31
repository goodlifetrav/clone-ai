import { Header } from '@/components/header'
import { HomeCta } from '@/components/home-cta'
import { TypewriterHeadline } from '@/components/typewriter-headline'
import { Zap } from 'lucide-react'
import Link from 'next/link'

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': 'https://igualai.com/#website',
      name: 'IgualAI',
      url: 'https://igualai.com',
      description:
        'Clone any website, funnel, or sales page. AI rebuilds it as your brand in seconds.',
      potentialAction: {
        '@type': 'SearchAction',
        target: 'https://igualai.com/?url={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'Organization',
      '@id': 'https://igualai.com/#organization',
      name: 'IgualAI',
      url: 'https://igualai.com',
      logo: {
        '@type': 'ImageObject',
        url: 'https://igualai.com/logo.png',
      },
    },
  ],
}

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="min-h-screen bg-white dark:bg-neutral-950 flex flex-col">
        <Header />

        {/* Hero */}
        <main className="flex-1 flex flex-col items-center justify-center px-4 pt-24 pb-16">

          {/* Animated headline */}
          <TypewriterHeadline />

          {/* Subtitle */}
          <p className="text-lg md:text-xl text-neutral-500 dark:text-neutral-400 text-center max-w-xl mb-12 leading-relaxed">
            Get an editable, AI-powered clone of any website in seconds.
            Rebuild it as your brand. Deploy anywhere.
          </p>

          {/* CTA */}
          <HomeCta />

          {/* Stats */}
          <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">
            10,000+ pages cloned
          </p>

        </main>

        {/* Footer */}
        <footer className="border-t border-neutral-100 dark:border-neutral-800/60 py-8 px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-400 dark:text-neutral-500">
          <div className="flex items-center gap-2">
            <Zap className="w-3 h-3" />
            <span>IgualAI</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link href="/pricing" className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">Pricing</Link>
            <Link href="/dashboard" className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">Dashboard</Link>
            <a href="mailto:support@igualai.com" className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">Contact Us</a>
            <Link href="/terms" className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">Privacy</Link>
            <Link href="/acceptable-use" className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">Acceptable Use</Link>
          </div>
        </footer>
      </div>
    </>
  )
}
