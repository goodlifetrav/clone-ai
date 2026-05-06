import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Plans & Tokens — IgualAI Docs',
  description: 'Understand IgualAI plans, token limits, and how to buy extra tokens.',
}

export default function PlansTokensPage() {
  return (
    <article className="max-w-none">
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-2">Plans & Tokens</h1>
      <p className="text-neutral-500 dark:text-neutral-400 mt-0 mb-8 text-base">
        Everything you need to know about usage limits and billing.
      </p>

      <Section title="Plans">
        <PlanTable />
      </Section>

      <Section title="What are tokens?">
        <p>
          Tokens are the AI's unit of work. Every time you use the AI editor, IgualAI sends your
          request (including the full page HTML) to the AI. The number of tokens consumed depends
          on the size of your page and the length of the AI's response.
        </p>
        <p>
          As a rough guide:
        </p>
        <ul>
          <li>A simple text change on a small page: ~1,000–3,000 tokens</li>
          <li>A layout change on a medium page: ~3,000–8,000 tokens</li>
          <li>A full-page redesign or major restructure: ~10,000–20,000 tokens</li>
        </ul>
        <p>
          Token usage resets at the start of each billing period (monthly).
        </p>
      </Section>

      <Section title="Token packs">
        <p>
          If you're on a Pro or Agency plan and run out of tokens before your billing period resets,
          you can buy a one-time token pack from{' '}
          <Link href="/settings" className="text-neutral-900 dark:text-white underline underline-offset-2">
            Settings
          </Link>
          :
        </p>
        <ul>
          <li><strong>Small — $5</strong> — 30,000 tokens</li>
          <li><strong>Medium — $10</strong> — 70,000 tokens</li>
          <li><strong>Large — $25</strong> — 200,000 tokens</li>
        </ul>
        <p>
          Token packs are additive — they extend your current period's allowance and don't roll
          over to the next month.
        </p>
      </Section>

      <Section title="Clones limit">
        <p>
          The "clones" limit refers to how many websites you can clone per billing period. The Free
          plan allows 1 clone. Pro allows 20 per month. Agency allows 60 per month.
        </p>
        <p>
          Cloning the same URL again (a re-clone) counts as a new clone. Editing an existing clone
          does not.
        </p>
      </Section>

      <Section title="Managing your subscription">
        <p>
          You can upgrade, downgrade, or cancel your subscription at any time from the{' '}
          <Link href="/settings" className="text-neutral-900 dark:text-white underline underline-offset-2">
            Billing section in Settings
          </Link>
          . Changes take effect at the end of your current billing period.
        </p>
        <p>
          For billing questions, email{' '}
          <a href="mailto:support@igualai.com" className="text-neutral-900 dark:text-white underline underline-offset-2">
            support@igualai.com
          </a>
          .
        </p>
      </Section>

      <div className="mt-10 flex gap-4">
        <Link
          href="/docs/custom-domains"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          ← Custom Domains
        </Link>
        <Link
          href="/docs/faq"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          Next: FAQ →
        </Link>
      </div>
    </article>
  )
}

function PlanTable() {
  const plans = [
    { name: 'Free', price: '$0', clones: '1 / mo', tokens: '10,000 / mo', domains: '—', packs: '—' },
    { name: 'Pro', price: '$10 / mo', clones: '20 / mo', tokens: '100,000 / mo', domains: '✓', packs: '✓' },
    { name: 'Agency', price: '$30 / mo', clones: '60 / mo', tokens: '300,000 / mo', domains: '✓', packs: '✓' },
  ]

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden text-sm not-prose my-4">
      <table className="w-full">
        <thead>
          <tr className="bg-neutral-50 dark:bg-neutral-800/50 text-left">
            <th className="px-4 py-2.5 font-medium text-neutral-700 dark:text-neutral-300">Plan</th>
            <th className="px-4 py-2.5 font-medium text-neutral-700 dark:text-neutral-300">Price</th>
            <th className="px-4 py-2.5 font-medium text-neutral-700 dark:text-neutral-300">Clones</th>
            <th className="px-4 py-2.5 font-medium text-neutral-700 dark:text-neutral-300">Tokens</th>
            <th className="px-4 py-2.5 font-medium text-neutral-700 dark:text-neutral-300">Custom Domains</th>
            <th className="px-4 py-2.5 font-medium text-neutral-700 dark:text-neutral-300">Token Packs</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.name} className="border-t border-neutral-200 dark:border-neutral-700">
              <td className="px-4 py-2.5 font-semibold text-neutral-900 dark:text-white">{p.name}</td>
              <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">{p.price}</td>
              <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">{p.clones}</td>
              <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">{p.tokens}</td>
              <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">{p.domains}</td>
              <td className="px-4 py-2.5 text-neutral-600 dark:text-neutral-300">{p.packs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold text-neutral-900 dark:text-white mb-3">{title}</h2>
      <div className="text-neutral-600 dark:text-neutral-300 space-y-3 text-[15px] leading-relaxed">
        {children}
      </div>
    </section>
  )
}
