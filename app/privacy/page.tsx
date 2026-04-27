import { Header } from '@/components/header'
import { Zap } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — IgualAI',
  description: 'Privacy Policy for IgualAI',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 flex flex-col">
      <Header />

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 pt-32 pb-20">
        <h1 className="text-4xl font-bold text-neutral-900 dark:text-white mb-2">Privacy Policy</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-12">Last updated: April 27, 2026</p>

        <div className="space-y-10 text-neutral-700 dark:text-neutral-300 text-sm leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">1. Introduction</h2>
            <p>IgualAI ("we", "us", "our") is committed to protecting your privacy. This Privacy Policy explains what information we collect, how we use it, and your rights regarding that information when you use our Service at igualai.com.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">2. Information We Collect</h2>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">2.1 Account Information (via Clerk)</h3>
            <p className="mb-3">Authentication and account management is handled by Clerk. When you sign up or sign in, we receive and store:</p>
            <ul className="list-disc pl-5 space-y-1 mb-3">
              <li>Email address</li>
              <li>Name (if provided via your sign-in method)</li>
              <li>Profile image (if provided by your OAuth provider)</li>
              <li>Clerk user ID (used internally to link your account to your projects)</li>
            </ul>
            <p>Clerk may collect additional data as described in <a href="https://clerk.com/privacy" className="underline hover:text-neutral-900 dark:hover:text-white" target="_blank" rel="noopener noreferrer">Clerk's Privacy Policy</a>.</p>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">2.2 Usage Data</h3>
            <p className="mb-3">We collect data about how you use the Service, including:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>URLs you submit for cloning</li>
              <li>AI token usage (number of tokens consumed per operation)</li>
              <li>Number of clones created</li>
              <li>Your current subscription plan</li>
              <li>Project names and creation timestamps</li>
            </ul>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">2.3 Cloned Website Content</h3>
            <p>The HTML content of websites you clone is stored in our database (Supabase) and associated with your account. This content is used to power the editor, version history, and preview features.</p>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">2.4 Payment Information (via Stripe)</h3>
            <p>Payment processing is handled entirely by Stripe. We do not store your credit card number, CVV, or full payment details. We store only your Stripe customer ID and subscription status to manage your plan. Stripe's data practices are governed by <a href="https://stripe.com/privacy" className="underline hover:text-neutral-900 dark:hover:text-white" target="_blank" rel="noopener noreferrer">Stripe's Privacy Policy</a>.</p>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">2.5 Technical Data</h3>
            <p>Like most web services, we may log standard server-side request data including IP addresses, browser user agents, and timestamps. This is used for security, debugging, and abuse prevention.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">3. How We Use Your Information</h2>
            <p className="mb-3">We use the information we collect to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Provide, operate, and improve the Service</li>
              <li>Authenticate you and manage your account</li>
              <li>Process payments and manage subscription plans</li>
              <li>Enforce usage limits (token quotas, clone limits) based on your plan</li>
              <li>Store and retrieve your cloned projects</li>
              <li>Respond to support requests and communicate with you about your account</li>
              <li>Detect and prevent fraud, abuse, and violations of our Terms of Service</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">4. How We Store Your Data</h2>
            <p className="mb-3">Your data is stored using the following infrastructure:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-neutral-800 dark:text-neutral-200">Supabase (PostgreSQL)</strong> — stores your account record, projects, version history, and chat messages</li>
              <li><strong className="text-neutral-800 dark:text-neutral-200">Supabase Storage</strong> — stores project thumbnail screenshots</li>
              <li><strong className="text-neutral-800 dark:text-neutral-200">Clerk</strong> — manages authentication credentials and session tokens</li>
              <li><strong className="text-neutral-800 dark:text-neutral-200">Stripe</strong> — manages payment methods and subscription billing</li>
            </ul>
            <p className="mt-3">All data is encrypted in transit (TLS) and at rest.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">5. Data We Do Not Collect or Sell</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>We do <strong className="text-neutral-800 dark:text-neutral-200">not</strong> sell your personal data to third parties</li>
              <li>We do <strong className="text-neutral-800 dark:text-neutral-200">not</strong> share your data with advertisers</li>
              <li>We do <strong className="text-neutral-800 dark:text-neutral-200">not</strong> use your cloned content to train AI models</li>
              <li>We do <strong className="text-neutral-800 dark:text-neutral-200">not</strong> store full credit card numbers or payment credentials</li>
              <li>We do <strong className="text-neutral-800 dark:text-neutral-200">not</strong> use third-party analytics or advertising trackers</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">6. Data Sharing</h2>
            <p className="mb-3">We share your data only in the following limited circumstances:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-neutral-800 dark:text-neutral-200">Service providers</strong> — Clerk, Stripe, Supabase, and Anthropic (Claude AI) as necessary to operate the Service. Each is bound by their own privacy policies and data processing agreements.</li>
              <li><strong className="text-neutral-800 dark:text-neutral-200">Legal requirements</strong> — if required by law, court order, or to protect the rights, safety, or property of IgualAI or others.</li>
              <li><strong className="text-neutral-800 dark:text-neutral-200">Business transfer</strong> — in connection with a merger, acquisition, or sale of assets, your data may be transferred as part of that transaction.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">7. Data Retention</h2>
            <p>We retain your account data and projects for as long as your account is active. If you delete your account, we will delete your data within 30 days, except where we are required to retain it for legal or fraud-prevention purposes. Anonymized, aggregated usage statistics may be retained indefinitely.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">8. Your Rights</h2>
            <p className="mb-3">Depending on your jurisdiction, you may have the following rights regarding your personal data:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-neutral-800 dark:text-neutral-200">Access</strong> — request a copy of the data we hold about you</li>
              <li><strong className="text-neutral-800 dark:text-neutral-200">Correction</strong> — request correction of inaccurate data</li>
              <li><strong className="text-neutral-800 dark:text-neutral-200">Deletion</strong> — request deletion of your account and associated data</li>
              <li><strong className="text-neutral-800 dark:text-neutral-200">Portability</strong> — request your data in a portable format</li>
              <li><strong className="text-neutral-800 dark:text-neutral-200">Objection</strong> — object to certain processing activities</li>
            </ul>
            <p className="mt-3">To exercise these rights, contact us. We will respond within 30 days.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">9. Children's Privacy</h2>
            <p>IgualAI is not directed to children under the age of 13. We do not knowingly collect personal information from children under 13. If we learn we have collected such information, we will delete it promptly.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">10. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of material changes by posting the new policy on this page with an updated date. Your continued use of the Service after changes constitutes acceptance.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">11. Contact</h2>
            <p>If you have questions about this Privacy Policy or your data, please contact us through our website.</p>
          </section>

        </div>
      </main>

      <footer className="border-t border-neutral-100 dark:border-neutral-800/60 py-8 px-6 flex items-center justify-between text-xs text-neutral-400 dark:text-neutral-500">
        <div className="flex items-center gap-2">
          <Zap className="w-3 h-3" />
          <span>IgualAI</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/terms" className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">Terms</Link>
          <Link href="/privacy" className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">Privacy</Link>
          <Link href="/acceptable-use" className="hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors">Acceptable Use</Link>
        </div>
      </footer>
    </div>
  )
}
