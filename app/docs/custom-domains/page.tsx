import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Custom Domains — IgualAI Docs',
  description: 'Connect a custom domain to your cloned page and enable HTTPS.',
}

export default function CustomDomainsPage() {
  return (
    <article className="max-w-none">
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-2">Custom Domains</h1>
      <p className="text-neutral-500 dark:text-neutral-400 mt-0 mb-8 text-base">
        Serve your cloned page on your own domain with automatic HTTPS.
      </p>

      <Section title="Overview">
        <p>
          IgualAI can serve any of your cloned pages directly on a custom domain. Once your domain
          is connected and verified, visitors who go to your domain will see your page — hosted on
          IgualAI's infrastructure, no separate hosting needed.
        </p>
      </Section>

      <Section title="Step 1 — Add your domain">
        <p>
          Go to{' '}
          <Link href="/settings" className="text-neutral-900 dark:text-white underline underline-offset-2">
            Settings → Custom Domains
          </Link>
          , type your domain (e.g. <code>mysite.com</code>), select which project to connect it
          to, and click <strong>Add</strong>.
        </p>
        <p>
          You'll see the DNS record you need to add:
        </p>
        <DnsTable />
      </Section>

      <Section title="Step 2 — Add the DNS record">
        <p>
          Log in to wherever you registered your domain (GoDaddy, Namecheap, Cloudflare, etc.) and
          add an <strong>A record</strong>:
        </p>
        <ul>
          <li><strong>Type:</strong> A</li>
          <li><strong>Name / Host:</strong> @ (represents the root domain)</li>
          <li><strong>Value / Points to:</strong> 187.124.219.202</li>
          <li><strong>TTL:</strong> 3600 (or Auto)</li>
        </ul>
        <p>
          For a subdomain like <code>app.mysite.com</code>, set Name to <code>app</code> instead
          of <code>@</code>.
        </p>
        <p>
          DNS changes propagate in 1–60 minutes, sometimes up to 24 hours depending on your
          registrar and TTL settings.
        </p>
      </Section>

      <Section title="Step 3 — Verify">
        <p>
          Once the DNS has propagated, click <strong>Verify DNS</strong> next to your domain in
          Settings. IgualAI checks that the domain resolves to our server. If it does, the domain
          is marked as verified and your page starts serving immediately.
        </p>
        <p>
          If verification fails, wait a few more minutes and try again. You can check propagation
          at{' '}
          <span className="font-mono text-sm bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">
            dnschecker.org
          </span>
          .
        </p>
      </Section>

      <Section title="Step 4 — Enable HTTPS (SSL)">
        <p>
          After verification, click the <strong>SSL</strong> button next to your domain. IgualAI
          automatically requests a free SSL certificate from Let's Encrypt. This usually completes
          within 1–2 minutes.
        </p>
        <p>
          Once SSL is active, your domain will redirect HTTP traffic to HTTPS automatically.
        </p>
      </Section>

      <Section title="Removing a domain">
        <p>
          Click the trash icon next to any domain in Settings to remove it. The domain will stop
          serving your page immediately. DNS records you added at your registrar are not
          automatically removed — you'll need to delete those yourself.
        </p>
      </Section>

      <div className="mt-10 flex gap-4">
        <Link
          href="/docs/ai-editor"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          ← AI Editor
        </Link>
        <Link
          href="/docs/plans-tokens"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          Next: Plans & Tokens →
        </Link>
      </div>
    </article>
  )
}

function DnsTable() {
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden text-sm not-prose my-4">
      <table className="w-full">
        <thead>
          <tr className="bg-neutral-50 dark:bg-neutral-800/50 text-left">
            <th className="px-4 py-2.5 font-medium text-neutral-700 dark:text-neutral-300">Type</th>
            <th className="px-4 py-2.5 font-medium text-neutral-700 dark:text-neutral-300">Name</th>
            <th className="px-4 py-2.5 font-medium text-neutral-700 dark:text-neutral-300">Value</th>
            <th className="px-4 py-2.5 font-medium text-neutral-700 dark:text-neutral-300">TTL</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-neutral-200 dark:border-neutral-700">
            <td className="px-4 py-2.5 font-mono text-neutral-900 dark:text-white">A</td>
            <td className="px-4 py-2.5 font-mono text-neutral-900 dark:text-white">@</td>
            <td className="px-4 py-2.5 font-mono text-neutral-900 dark:text-white">187.124.219.202</td>
            <td className="px-4 py-2.5 text-neutral-500 dark:text-neutral-400">3600</td>
          </tr>
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
