import { Header } from '@/components/header'
import { UrlInput } from '@/components/url-input'
import { Zap, Globe, Code2, Sparkles } from 'lucide-react'
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
        'Paste a URL and get an editable, AI-powered clone in seconds. Customize with chat, deploy anywhere.',
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
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What is IgualAI?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'IgualAI is an AI-powered website cloning tool. Paste any URL and Claude AI instantly reconstructs it as a clean, editable HTML/CSS page you can customize with chat and deploy anywhere.',
          },
        },
        {
          '@type': 'Question',
          name: 'How does website cloning work?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'IgualAI uses headless Chromium to visit the page, take a full-page screenshot, and extract its HTML. Claude AI then rebuilds the site as self-contained HTML with inlined CSS — no dependencies, no frameworks.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is IgualAI free?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes! The free plan lets you clone 1 website and includes 10,000 AI tokens for editing. Paid plans start at $10/month for unlimited clones and more AI tokens.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can I edit the cloned website?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Absolutely. Every clone opens in our live editor where you can chat with AI to make changes, edit the code directly, or use the visual editor. Changes appear instantly in the preview.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can I download or deploy my clone?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Download as a self-contained ZIP file that works offline, or deploy directly to Vercel with one click. Paid plans also support GitHub and Shopify integrations.',
          },
        },
      ],
    },
  ],
}

const FAQS = [
  {
    q: 'What is IgualAI?',
    a: 'IgualAI is an AI-powered website cloning tool. Paste any URL and Claude AI instantly reconstructs it as a clean, editable HTML/CSS page you can customize with chat and deploy anywhere.',
  },
  {
    q: 'How does website cloning work?',
    a: 'IgualAI uses headless Chromium to visit the page, take a full-page screenshot, and extract its HTML. Claude AI then rebuilds the site as self-contained HTML with inlined CSS — no dependencies, no frameworks.',
  },
  {
    q: 'Is IgualAI free?',
    a: 'Yes! The free plan lets you clone 1 website and includes 10,000 AI tokens for editing. Paid plans start at $10/month for unlimited clones and more AI tokens.',
  },
  {
    q: 'Can I edit the cloned website?',
    a: 'Absolutely. Every clone opens in our live editor where you can chat with AI to make changes, edit the code directly, or use the visual editor. Changes appear instantly in the preview.',
  },
  {
    q: 'Can I download or deploy my clone?',
    a: 'Yes. Download as a self-contained ZIP file that works offline, or deploy directly to Vercel with one click. Paid plans also support GitHub and Shopify integrations.',
  },
]

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
          {/* Badge */}
          <div className="flex items-center gap-2 mb-8 px-3 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-xs text-neutral-600 dark:text-neutral-400">
            <Sparkles className="w-3 h-3 text-neutral-500" />
            Powered by Claude AI
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-7xl font-bold text-center tracking-tight text-neutral-900 dark:text-white max-w-3xl leading-tight mb-6">
            Clone Any Website
          </h1>

          {/* Subtitle */}
          <p className="text-lg md:text-xl text-neutral-500 dark:text-neutral-400 text-center max-w-xl mb-12 leading-relaxed">
            Paste a URL and get an editable, AI-powered clone in seconds.
            Customize with chat, deploy anywhere.
          </p>

          {/* URL Input */}
          <UrlInput />

          {/* Stats */}
          <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">
            10,000+ websites cloned
          </p>

          {/* Feature grid */}
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8 max-w-3xl w-full">
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
                  'Chat to make changes instantly. Code editor and live preview side by side.',
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

          {/* FAQ Section */}
          <div className="mt-20 max-w-2xl w-full">
            <h2 className="text-2xl font-bold text-center text-neutral-900 dark:text-white mb-10">
              Frequently Asked Questions
            </h2>
            <div className="space-y-6">
              {FAQS.map((faq) => (
                <div
                  key={faq.q}
                  className="border-b border-neutral-100 dark:border-neutral-800 pb-6"
                >
                  <h3 className="font-semibold text-neutral-900 dark:text-white mb-2">
                    {faq.q}
                  </h3>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                    {faq.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-neutral-100 dark:border-neutral-800/60 py-8 px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-400 dark:text-neutral-500">
          <div className="flex items-center gap-2">
            <Zap className="w-3 h-3" />
            <span>IgualAI</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link
              href="/pricing"
              className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/dashboard"
              className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            >
              Dashboard
            </Link>
            <Link
              href="/terms"
              className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/acceptable-use"
              className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
            >
              Acceptable Use
            </Link>
          </div>
        </footer>
      </div>
    </>
  )
}
