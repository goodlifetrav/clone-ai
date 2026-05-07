import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'FAQ — IgualAI Docs',
  description: 'Frequently asked questions about IgualAI.',
}

const FAQS = [
  {
    q: 'What kinds of websites can IgualAI clone?',
    a: 'Publicly accessible marketing sites, SaaS landing pages, portfolios, agency sites, and business homepages. Sites behind a login or paywall may not clone fully. The following categories are blocked: government and military sites, educational institutions (.gov, .edu), banks and financial institutions, cryptocurrency and NFT platforms, social media platforms, news and media outlets, gambling sites, healthcare and medical sites, legal services, adult content, and real estate listing platforms.',
  },
  {
    q: 'Will the clone look exactly like the original?',
    a: 'The initial clone is a faithful visual replica of the layout and design. The intended workflow is to then use the Brand Wizard or AI Chat to transform it into a completely original website for your brand — replacing all content, colors, and copy while preserving the page structure. Your final site is 100% original and copyright-safe.',
  },
  {
    q: 'Is cloning websites legal?',
    a: 'IgualAI is designed for brand transformation — you clone a layout and structure, then rebuild it as something entirely new for your business. The output is an original website inspired by a layout, not a copy of anyone\'s content. You are responsible for your use of the tool. Do not republish copyrighted content as your own. See our Acceptable Use Policy for details.',
  },
  {
    q: 'Can I clone a website I own?',
    a: 'Yes — many users clone their own existing sites to rapidly prototype a redesign, create a landing page variant, or migrate to a new brand identity.',
  },
  {
    q: 'Why did my clone fail or look broken?',
    a: 'Some sites block automated access, use heavy client-side rendering, or serve different content to non-human visitors. Try re-cloning. If it still fails, the site may be incompatible with our capture process.',
  },
  {
    q: 'What is the Brand Wizard?',
    a: 'The Brand Wizard is a guided setup that opens automatically after a clone finishes. It collects your brand name, colors, logo, tagline, and key copy — then rebuilds the entire page in one shot as a launch-ready site for your brand. You can also re-open it anytime from the Visual tab.',
  },
  {
    q: 'What is the Visual Editor?',
    a: 'After any AI rebuild, the Visual tab becomes a live editor. You can click directly on any text — headlines, nav links, buttons, paragraphs — to edit it inline without writing a prompt. You can also click any image to swap it with a new URL or a stock photo keyword. Changes save automatically.',
  },
  {
    q: 'What\'s the difference between the first AI chat message and follow-up messages?',
    a: 'The first message triggers a full brand rebuild — IgualAI reads the entire page structure and regenerates every section with your brand\'s content and styling. Follow-up messages are targeted edits: the AI changes only what you specifically ask for and leaves everything else exactly as it is.',
  },
  {
    q: 'Do Visual Editor changes use tokens?',
    a: 'No. Inline text and image edits in the Visual Editor are free and do not consume tokens. Only AI Chat and Brand Wizard generations use tokens.',
  },
  {
    q: 'What happens to my pages if I cancel my plan?',
    a: 'Your projects remain accessible. You\'ll be downgraded to the Free plan limits but won\'t lose any existing clones. Custom domains will continue to work until you remove them.',
  },
  {
    q: 'How do I get a refund?',
    a: 'Email support@igualai.com within 7 days of your charge. We\'ll review on a case-by-case basis.',
  },
  {
    q: 'Can I use IgualAI for client work?',
    a: 'Yes. The Agency plan is designed for agencies and freelancers who need to rapidly prototype or deliver sites for multiple clients.',
  },
  {
    q: 'Does IgualAI support images from the original site?',
    a: 'Images from the cloned site are preserved as external references. If the original site blocks hotlinking, images may not display. For permanent hosting, download the page and re-host images on your own server.',
  },
  {
    q: 'What technology powers IgualAI?',
    a: 'IgualAI uses a proprietary capture and reconstruction pipeline to process cloned pages, and a custom AI layer for the Brand Wizard and chat editor. We don\'t share specifics about the stack.',
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
