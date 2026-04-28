import { Header } from '@/components/header'
import { PricingCards } from '@/components/pricing/pricing-cards'

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      <Header />

      <main className="pt-24 pb-16 px-4">
        {/* Header */}
        <div className="text-center max-w-xl mx-auto mb-16">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-neutral-900 dark:text-white mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-lg text-neutral-500 dark:text-neutral-400">
            Start for free. Upgrade as you grow. Cancel anytime.
          </p>
        </div>

        {/* Cards */}
        <div className="max-w-7xl mx-auto">
          <PricingCards />
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto mt-20">
          <h2 className="text-2xl font-bold text-center text-neutral-900 dark:text-white mb-10">
            Frequently Asked Questions
          </h2>

          <div className="space-y-6">
            {[
              {
                q: 'What counts as a token?',
                a: 'Tokens are units of text processed by the AI. Each word is approximately 1-2 tokens. Cloning and editing websites uses tokens from your monthly allowance.',
              },
              {
                q: 'Can I cancel anytime?',
                a: 'Yes. You can cancel your subscription at any time from Account Settings. You will retain access until the end of your billing period.',
              },
              {
                q: 'What happens to my projects if I downgrade?',
                a: 'Your projects are preserved. You will just lose access to premium features like downloads, forking, and deployment.',
              },
              {
                q: 'Does the cloned site work offline?',
                a: 'Yes! The downloaded ZIP contains a self-contained index.html with all CSS inlined, so it works without any server or internet connection.',
              },
              {
                q: 'Is there an API?',
                a: 'API access is planned for the Growth and Max tiers. Join our waitlist to be notified.',
              },
            ].map((faq) => (
              <div key={faq.q} className="border-b border-neutral-100 dark:border-neutral-800 pb-6">
                <h3 className="font-semibold text-neutral-900 dark:text-white mb-2">{faq.q}</h3>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center p-6 rounded-2xl border border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40">
            <p className="text-sm text-neutral-600 dark:text-neutral-300 font-medium mb-1">
              Have billing or subscription questions?
            </p>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Email us directly at{' '}
              <a
                href="mailto:support@igualai.com"
                className="text-neutral-900 dark:text-white underline underline-offset-2 hover:no-underline"
              >
                support@igualai.com
              </a>
              {' '}and we&apos;ll get back to you within 24 hours.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
