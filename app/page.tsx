import { Header } from '@/components/header'
import { UrlInput } from '@/components/url-input'
import { TypewriterHeadline } from '@/components/typewriter-headline'
import { Zap, Globe, Sparkles, ShoppingBag, FolderOpen } from 'lucide-react'
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
        'Clone any website, Shopify store, funnel, or sales page. AI rebuilds it as your brand in seconds.',
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
          name: 'What can IgualAI clone?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Any publicly accessible website, Shopify store, sales funnel, landing page, or sales page. Paste the URL and IgualAI captures and rebuilds it as clean, editable HTML in seconds.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can I clone a Shopify store?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Clone the homepage, product pages, and collection pages. Use the Brand Wizard to rebuild each page with your brand identity, then push the entire site to your Shopify store as a fully structured theme — complete with Liquid sections, color pickers in the Shopify editor, and live product data.',
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
          name: 'How does the AI Brand Rebuild work?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'After cloning, open the Brand Wizard and enter your brand name, colors, logo, and a short description. IgualAI uses the cloned page\'s structure as a blueprint and regenerates every section with your brand\'s identity, copy, and styling. Group pages in a folder and the brand syncs automatically across all of them.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can I download or deploy my clone?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Download as a self-contained HTML file, connect a custom domain, push to GitHub, or export directly to Shopify as a theme.',
          },
        },
      ],
    },
  ],
}

const FAQS = [
  {
    q: 'What can IgualAI clone?',
    a: 'Any publicly accessible website, Shopify store, sales funnel, landing page, or sales page. Paste the URL and IgualAI captures and rebuilds it as clean, editable HTML in seconds.',
  },
  {
    q: 'Can I clone a Shopify store?',
    a: 'Yes. Clone the homepage, product pages, and collection pages. Use the Brand Wizard to rebuild each page with your brand, then push the entire site to your Shopify store as a fully structured theme — complete with Liquid sections, color pickers in the Shopify editor, and live product data.',
  },
  {
    q: 'How does the AI Brand Rebuild work?',
    a: "After cloning, open the Brand Wizard and enter your brand name, colors, logo, and a short description. IgualAI uses the cloned page's structure as a blueprint and regenerates every section with your brand's identity, copy, and styling. Group pages in a folder and the brand auto-fills on every other page in that folder.",
  },
  {
    q: 'What is a folder?',
    a: "A folder groups all the pages of one website together. Set up your brand once on any page in a folder and every other page in that folder will automatically load your brand info — no re-entering required. When you push to Shopify, all pages in the folder go into one theme.",
  },
  {
    q: 'Is IgualAI free?',
    a: 'Yes! The free plan lets you clone 1 website and includes 10,000 AI tokens for editing. Paid plans start at $10/month for unlimited clones and more AI tokens.',
  },
  {
    q: 'Can I edit the cloned page?',
    a: 'Absolutely. Every clone opens in our live editor where you can chat with AI to make changes, edit the code directly, or use the visual editor to click and edit text and images inline.',
  },
  {
    q: 'Can I download or deploy my clone?',
    a: 'Yes. Download as a self-contained HTML file, connect a custom domain, push to GitHub, or export directly to Shopify as a fully structured theme.',
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

          {/* Animated headline */}
          <TypewriterHeadline />

          {/* Subtitle */}
          <p className="text-lg md:text-xl text-neutral-500 dark:text-neutral-400 text-center max-w-xl mb-12 leading-relaxed">
            Paste a URL and get an editable, AI-powered clone in seconds.
            Rebuild it as your brand. Deploy to Shopify or anywhere.
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
                  'Websites, Shopify stores, funnels, sales pages, landing pages — paste a URL and get a clean editable copy in seconds.',
              },
              {
                icon: <Sparkles className="w-5 h-5" />,
                title: 'AI Brand Rebuild',
                description:
                  'Enter your brand once. AI rebuilds every page with your colors, copy, and identity. Group pages in a folder to sync automatically.',
              },
              {
                icon: <ShoppingBag className="w-5 h-5" />,
                title: 'Push to Shopify',
                description:
                  'Export as a fully structured Shopify theme with Liquid sections, color pickers, and live product data — ready to publish.',
              },
              {
                icon: <FolderOpen className="w-5 h-5" />,
                title: 'Multi-Page Projects',
                description:
                  'Group a homepage, product pages, and collection pages in one folder. Push them all as a single Shopify theme in one click.',
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
