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
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What can IgualAI clone?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Any publicly accessible website, sales funnel, landing page, or sales page. Paste the URL and IgualAI captures and rebuilds it as clean, editable HTML in seconds.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is IgualAI free?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. The Free plan includes 1 clone and 75,000 AI tokens per month. Pro is $19/month (20 clones, 2M tokens). Agency is $49/month (60 clones, 6M tokens). Visual Editor changes are always free and never use tokens.',
          },
        },
        {
          '@type': 'Question',
          name: 'How does the AI Brand Rebuild work?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: "Open the Brand Wizard from the editor toolbar. Enter your brand name, colors, logo, and a short description. IgualAI uses the cloned page's layout as a structural blueprint and regenerates every section with your brand's identity and copy. Add pages to a folder and the brand syncs automatically — no re-entering required.",
          },
        },
        {
          '@type': 'Question',
          name: 'Is cloning websites legal?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: "IgualAI is designed for brand transformation — you clone a layout and structure, then rebuild it as something entirely new for your business. The output is an original page inspired by a layout, not a copy of anyone's content. You are responsible for your use of the tool. See our Acceptable Use Policy for details.",
          },
        },
        {
          '@type': 'Question',
          name: 'Can I download or deploy my clone?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Download as a self-contained HTML file, connect a custom domain, push to GitHub, or deploy to Vercel.',
          },
        },
      ],
    },
  ],
}

const FAQS = [
  {
    q: 'What can IgualAI clone?',
    a: 'Any publicly accessible website, sales funnel, landing page, or sales page. Paste the URL and IgualAI captures and rebuilds it as clean, editable HTML in seconds. Sites behind a login or paywall may not clone fully.',
  },
  {
    q: 'What is a folder?',
    a: "A folder groups all the pages of one website together. Set up your brand once on any page in a folder and every other page in that folder automatically loads your brand info — no re-entering required. Build a full funnel or multi-page site and keep everything in sync.",
  },
  {
    q: 'How does the AI Brand Rebuild work?',
    a: "Open the Brand Wizard from the editor toolbar. Enter your brand name, colors, logo, and a short description. IgualAI uses the cloned page's layout as a structural blueprint and regenerates every section with your brand's identity and copy. For product pages, a Product Details step lets you describe the product so the AI styles supporting sections correctly.",
  },
  {
    q: 'How does editing work after the rebuild?',
    a: "You have two options. AI Chat: describe what you want changed in plain English — follow-up messages make targeted edits without touching anything you didn't ask about. Visual Editor: click directly on any text or image in the preview to edit it inline. Visual Editor changes are always free and never use tokens.",
  },
  {
    q: 'What are tokens?',
    a: "Tokens are the AI's unit of work. A full Brand Wizard rebuild uses roughly 50,000–70,000 tokens. A targeted follow-up edit uses 5,000–15,000. Visual Editor changes (click-to-edit text and images) use zero tokens. The Free plan includes 75,000 tokens/month. Pro includes 2,000,000. You can buy token packs from Settings if you run out mid-month.",
  },
  {
    q: 'Is cloning websites legal?',
    a: "IgualAI is designed for brand transformation — you clone a layout and structure, then rebuild it as something entirely new for your business. The output is an original page inspired by a layout, not a copy of anyone's content. You are responsible for your use of the tool. See our Acceptable Use Policy for details.",
  },
  {
    q: 'Is IgualAI free?',
    a: 'Yes. The Free plan includes 1 clone and 75,000 AI tokens per month at no cost. Pro is $19/month (20 clones, 2M tokens, custom domains). Agency is $49/month (60 clones, 6M tokens). Visual Editor changes are always free.',
  },
  {
    q: 'Can I download or deploy my clone?',
    a: 'Yes. Download as a self-contained HTML file you can host anywhere, connect a custom domain to serve it directly from IgualAI, push to GitHub (Pro/Agency), or deploy to Vercel.',
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
