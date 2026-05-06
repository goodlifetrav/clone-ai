import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'FAQ — IgualAI Docs',
  description: 'Frequently asked questions about IgualAI.',
}

const FAQS = [
  {
    q: 'What kinds of websites can IgualAI clone?',
    a: 'Any publicly accessible website. This includes landing pages, marketing sites, portfolios, blogs, and SaaS homepages. Sites behind a login, paywalls, or that block headless browsers may not clone fully.',
  },
  {
    q: 'Will the clone look exactly like the original?',
    a: 'It will be a close visual replica, especially for static content. Complex JavaScript interactions (sliders, animations, dynamic data loading) won\'t be reproduced since the clone is a static HTML file. The layout, colors, typography, and written content will be accurate.',
  },
  {
    q: 'Is cloning websites legal?',
    a: 'IgualAI is intended for legitimate use cases: recreating a style you own, using a design as inspiration for your own work, building internal prototypes, or saving a snapshot of public content. You are responsible for how you use cloned content. Do not republish copyrighted content as your own. See our Acceptable Use Policy for details.',
  },
  {
    q: 'Can I clone a website I own?',
    a: 'Yes — many users clone their own existing sites to rapidly prototype a redesign, create a landing page variant, or migrate content.',
  },
  {
    q: 'Why did my clone fail or look broken?',
    a: 'Some sites block headless browsers, use heavy client-side rendering that doesn\'t complete before the screenshot, or serve different content to automated clients. Try re-cloning. If it still fails, the site may be incompatible.',
  },
  {
    q: 'What happens to my pages if I cancel my plan?',
    a: 'Your projects remain accessible. You\'ll be downgraded to the Free plan limits but won\'t lose any existing clones. Custom domains will continue to work until you remove them.',
  },
  {
    q: 'How do I get a refund?',
    a: 'Email support@igualai.com within 7 days of your charge. We\'ll refund on a case-by-case basis.',
  },
  {
    q: 'Can I use IgualAI for client work?',
    a: 'Yes. The Agency plan is designed for agencies and freelancers who need to rapidly prototype or deliver sites for multiple clients.',
  },
  {
    q: 'Does IgualAI support images from the original site?',
    a: 'Background images and img tags from the original site are preserved as external URLs pointing to the original source. If the original site goes down or blocks hotlinking, images may break. For permanent hosting, download the page and re-host images yourself.',
  },
  {
    q: 'What AI model does IgualAI use?',
    a: 'IgualAI uses Claude (by Anthropic) for both the initial clone reconstruction and the AI chat editor.',
  },
]

export default function FaqPage() {
  return (
    <article className="max-w-none">
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-2">
        Frequently Asked Questions
      </h1>
      <p className="text-neutral-500 dark:text-neutral-400 mt-0 mb-8 text-base">
        Can't find your answer?{' '}
        <a href="mailto:support@igualai.com" className="text-neutral-900 dark:text-white underline underline-offset-2">
          Email support
        </a>
        .
      </p>

      <div className="space-y-6 not-prose">
        {FAQS.map(({ q, a }) => (
          <div
            key={q}
            className="border border-neutral-200 dark:border-neutral-700 rounded-xl p-5"
          >
            <h3 className="text-[15px] font-semibold text-neutral-900 dark:text-white mb-2">{q}</h3>
            <p className="text-[15px] text-neutral-600 dark:text-neutral-300 leading-relaxed m-0">{a}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex gap-4">
        <Link
          href="/docs/plans-tokens"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          ← Plans & Tokens
        </Link>
      </div>
    </article>
  )
}
