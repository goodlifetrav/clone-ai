import { Header } from '@/components/header'
import { Zap } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Acceptable Use Policy — IgualAI',
  description: 'Acceptable Use Policy for IgualAI',
}

export default function AcceptableUsePage() {
  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950 flex flex-col">
      <Header />

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 pt-32 pb-20">
        <h1 className="text-4xl font-bold text-neutral-900 dark:text-white mb-2">Acceptable Use Policy</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-12">Last updated: April 27, 2026</p>

        <div className="space-y-10 text-neutral-700 dark:text-neutral-300 text-sm leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">1. Purpose</h2>
            <p>This Acceptable Use Policy ("AUP") defines the standards for appropriate use of IgualAI. It supplements our <Link href="/terms" className="underline hover:text-neutral-900 dark:hover:text-white">Terms of Service</Link> and applies to all users. Violations may result in immediate account suspension or termination.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">2. Permitted Uses</h2>
            <p className="mb-3">IgualAI is designed to support legitimate design and development workflows. Permitted uses include:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Creating design references for original projects you own or are authorized to build</li>
              <li>Prototyping and wireframing based on publicly available design patterns</li>
              <li>Educational study of HTML, CSS, and web design techniques</li>
              <li>Archiving or backing up websites you own or control</li>
              <li>Analyzing publicly available UI layouts for competitive research (visual reference only, not republishing)</li>
              <li>Generating starting templates that you substantially modify for your own original work</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">3. Prohibited Uses</h2>
            <p className="mb-3">The following uses are strictly prohibited and will result in immediate account termination:</p>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">3.1 Fraud and Phishing</h3>
            <ul className="list-disc pl-5 space-y-1 mb-4">
              <li>Cloning websites to impersonate banks, payment processors, government agencies, or any other organization for the purpose of deceiving users</li>
              <li>Creating fake login pages to harvest credentials</li>
              <li>Using cloned sites in phishing campaigns, spam, or social engineering attacks</li>
            </ul>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">3.2 Malware and Harmful Code</h3>
            <ul className="list-disc pl-5 space-y-1 mb-4">
              <li>Embedding malicious scripts, tracking code, or exploit payloads in cloned output</li>
              <li>Distributing the cloned output as a vehicle for malware delivery</li>
              <li>Using the Service to test or develop attack tools</li>
            </ul>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">3.3 Copyright Infringement</h3>
            <ul className="list-disc pl-5 space-y-1 mb-4">
              <li>Publishing, selling, or distributing cloned content that reproduces copyrighted material without authorization from the rights holder</li>
              <li>Operating a competing service using another company's website design without permission</li>
              <li>Systematically cloning and republishing content from news sites, e-commerce platforms, or other content-rich sites</li>
            </ul>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">3.4 Data Harvesting</h3>
            <ul className="list-disc pl-5 space-y-1 mb-4">
              <li>Using the Service to collect personal data (names, emails, phone numbers) from cloned pages</li>
              <li>Scraping competitor pricing, product catalogs, or proprietary data for automated bulk extraction</li>
              <li>Building datasets from cloned content for machine learning or AI training without rights holder consent</li>
            </ul>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">3.5 Illegal Content</h3>
            <ul className="list-disc pl-5 space-y-1 mb-4">
              <li>Cloning sites that host or distribute child sexual abuse material (CSAM)</li>
              <li>Cloning content related to illegal weapons, controlled substances, or human trafficking</li>
              <li>Any use that violates applicable local, state, national, or international law</li>
            </ul>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">3.6 Service Abuse</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Attempting to circumvent rate limits, clone quotas, or plan restrictions through automated means or multiple accounts</li>
              <li>Using the Service to generate excessive load on target websites without authorization</li>
              <li>Reverse engineering, decompiling, or attempting to extract the Service's source code or AI prompts</li>
              <li>Reselling access to the Service or cloned output at scale without our written consent</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">4. DMCA Takedown Process</h2>
            <p className="mb-3">IgualAI takes copyright claims seriously and complies with the Digital Millennium Copyright Act.</p>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">4.1 Filing a Takedown Notice</h3>
            <p className="mb-3">If you believe content stored on IgualAI infringes your copyright, submit a notice that includes:</p>
            <ol className="list-decimal pl-5 space-y-1 mb-3">
              <li>Your full legal name and contact information (address, phone, email)</li>
              <li>A description of the copyrighted work you claim is infringed</li>
              <li>The specific URL or identifier of the infringing content on IgualAI</li>
              <li>A statement of good-faith belief that the use is not authorized by the rights holder, its agent, or the law</li>
              <li>A statement, under penalty of perjury, that you are authorized to act on behalf of the copyright owner</li>
              <li>Your physical or electronic signature</li>
            </ol>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">4.2 What Happens After We Receive a Notice</h3>
            <ol className="list-decimal pl-5 space-y-1 mb-3">
              <li>We review the notice for completeness and validity</li>
              <li>We promptly remove or disable access to the identified content</li>
              <li>We notify the account holder whose content was removed</li>
              <li>The account holder may file a counter-notice if they believe the removal was in error</li>
              <li>If we receive a valid counter-notice, we may restore the content after 10–14 business days unless the claimant files a court action</li>
            </ol>

            <h3 className="font-medium text-neutral-800 dark:text-neutral-200 mb-2 mt-4">4.3 Repeat Infringers</h3>
            <p>Users who receive multiple valid DMCA notices will have their accounts permanently terminated in accordance with our repeat infringer policy.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">5. Consequences of Violations</h2>
            <p className="mb-3">Violations of this AUP may result in, at our sole discretion:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-neutral-800 dark:text-neutral-200">Warning</strong> — for minor or first-time violations</li>
              <li><strong className="text-neutral-800 dark:text-neutral-200">Content removal</strong> — immediate deletion of the offending project or content</li>
              <li><strong className="text-neutral-800 dark:text-neutral-200">Account suspension</strong> — temporary loss of access pending investigation</li>
              <li><strong className="text-neutral-800 dark:text-neutral-200">Account termination</strong> — permanent ban with no refund for violations involving fraud, phishing, malware, or repeated copyright infringement</li>
              <li><strong className="text-neutral-800 dark:text-neutral-200">Legal referral</strong> — reporting to law enforcement where required by law or where the violation involves criminal activity</li>
            </ul>
            <p className="mt-3">We reserve the right to take immediate action without notice for serious violations.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">6. Reporting Violations</h2>
            <p>If you become aware of content on IgualAI that violates this AUP, please contact us through our website. We investigate all credible reports and take appropriate action.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white mb-3">7. Changes to This Policy</h2>
            <p>We may update this AUP at any time. Continued use of the Service after changes constitutes acceptance of the updated policy.</p>
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
