import { Header } from '@/components/header'
import { UrlInput } from '@/components/url-input'
import { Zap, Globe, Code2, Sparkles } from 'lucide-react'
import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 flex flex-col">
      <Header />

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 pt-24 pb-16">
        {/* Badge */}
        <div className="flex items-center gap-2 mb-8 px-3 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-xs text-neutral-600 dark:text-neutral-400">
          <Sparkles className="w-3 h-3 text-neutral-500" />
          Powered by Claude AI
        </div>

        {/* Headline */}
        <h1 className="text-5xl md:text-7xl font-bold text-center tracking-tight text-neutral-900 dark:text-white max-w-3xl leading-tight mb-6">
          Clone Any Website
          <br />
          <span className="text-neutral-400 dark:text-neutral-500">with AI</span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg md:text-xl text-neutral-500 dark:text-neutral-400 text-center max-w-xl mb-12 leading-relaxed">
          Paste a URL and get an editable, AI-powered clone in seconds.
          Customize with chat, deploy anywhere.
        </p>

        {/* URL Input */}
        <UrlInput />

        {/* Stats */}
        <p className="mt-8 text-sm text-neutral-400 dark:text-neutral-500">
          10,000+ websites cloned
        </p>

        {/* Feature grid */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-3xl w-full">
          {[
            {
              icon: <Globe className="w-5 h-5" />,
              title: 'Instant Scraping',
              description:
                'Full-page screenshots and HTML extraction via headless Chromium.',
            },
            {
              icon: <Sparkles className="w-5 h-5" />,
              title: 'AI Reconstruction',
              description:
                'Claude AI rebuilds the site as clean, self-contained HTML with inline CSS.',
            },
            {
              icon: <Code2 className="w-5 h-5" />,
              title: 'Live Editor',
              description:
                'Split-screen preview and Monaco code editor. Chat to make changes instantly.',
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
      <footer className="border-t border-neutral-100 dark:border-neutral-800/60 py-8 px-6 flex items-center justify-between text-xs text-neutral-400 dark:text-neutral-500">
        <div className="flex items-center gap-2">
          <Zap className="w-3 h-3" />
          <span>CloneAI</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/pricing" className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">
            Pricing
          </Link>
          <Link href="/dashboard" className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">
            Dashboard
          </Link>
        </div>
      </footer>
    </div>
  )
}
