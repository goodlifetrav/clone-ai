import { Header } from '@/components/header'
import { UrlInput } from '@/components/url-input'
import { TypewriterHeadline } from '@/components/typewriter-headline'
import { Zap, Globe, Sparkles, Upload, FolderOpen } from 'lucide-react'
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
            Paste a URL and get an editable, AI-powered clone in seconds.
            Rebuild it as your brand. Deploy anywhere.
          </p>

          {/* URL Input */}
          <UrlInput />

          {/* Stats */}
          <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">
            10,000+ pages cloned
          </p>

          {/* Feature grid */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl w-full">
            {[
              {
                icon: <Globe className="w-5 h-5" />,
                title: 'Clone Anything',
                description:
                  'Websites, funnels, sales pages, landing pages — paste a URL and get a clean editable copy in seconds.',
              },
              {
                icon: <Sparkles className="w-5 h-5" />,
                title: 'AI Brand Rebuild',
                description:
                  'Enter your brand once. AI rebuilds every page with your colors, copy, and identity. Group pages in a folder to sync automatically.',
              },
              {
                icon: <Upload className="w-5 h-5" />,
                title: 'Deploy Anywhere',
                description:
                  'Export to GitHub, deploy to Vercel, connect a custom domain, or download as a self-contained HTML file.',
              },
              {
                icon: <FolderOpen className="w-5 h-5" />,
                title: 'Multi-Page Projects',
                description:
                  'Group all pages of a funnel or site in one folder. Set your brand once and every page syncs automatically.',
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="flex flex-col gap-3 p-6 rounded-2xl border border-neutral-100 dark:border-neutral-800/60 bg-neutral-50/50 dark:bg-neutral-900/30"
              >
                <div className="w-9 h-9 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-600 dark:text-neutral-300">
                  {feature.icon}
                </div>
                <h3 className="font-semibold text-neutral-900 dark:text-white">
                  {feature.title}
                </h3>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>

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
