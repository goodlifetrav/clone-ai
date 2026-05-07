import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Getting Started — IgualAI Docs',
  description: 'Learn how to clone your first website with IgualAI in seconds.',
}

export default function GettingStartedPage() {
  return (
    <article className="max-w-none">
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-2">Getting Started</h1>
      <p className="text-neutral-500 dark:text-neutral-400 mt-0 mb-8 text-base">
        Clone your first website in under a minute.
      </p>

      <Section title="1. Paste a URL">
        <p>
          Go to{' '}
          <Link href="/" className="text-neutral-900 dark:text-white font-medium underline underline-offset-2">
            igualai.com
          </Link>{' '}
          and paste any public website URL into the input on the homepage. Press{' '}
          <Kbd>Enter</Kbd> or click <strong>Clone</strong>.
        </p>
        <p>
          IgualAI uses a proprietary pipeline to capture the page and reconstruct it as a
          clean, self-contained HTML file. The process typically completes in 5–15 seconds.
        </p>
      </Section>

      <Section title="2. The Brand Wizard opens automatically">
        <p>
          The moment your clone finishes, the Brand Wizard launches. This is where you tell
          IgualAI about your brand so it can rebuild the page as something entirely your own:
        </p>
        <ul>
          <li><strong>Brand Identity</strong> — name, tagline, logo URL, and a short description of your business</li>
          <li><strong>Colors</strong> — primary, secondary, and accent brand colors</li>
          <li><strong>Content</strong> — hero headline, subheadline, and CTA button text</li>
        </ul>
        <p>
          Hit <strong>Rebuild</strong> and IgualAI generates a fully original, launch-ready page
          using the cloned site&apos;s layout as its structural blueprint.
        </p>
      </Section>

      <Section title="3. Fine-tune with AI Chat or Visual Editor">
        <p>
          After the initial rebuild, you have two ways to keep refining:
        </p>
        <ul>
          <li>
            <strong>AI Chat</strong> — describe what you want changed in plain English.
            Follow-up messages make targeted edits without touching anything you didn&apos;t ask about.
          </li>
          <li>
            <strong>Visual Editor</strong> — click directly on any text or image in the page to
            edit it inline. No prompts needed — just click, type, and save.
          </li>
        </ul>
      </Section>

      <Section title="4. Download or deploy">
        <p>
          When you&apos;re happy with the result, you can:
        </p>
        <ul>
          <li><strong>Download</strong> — get a single <code>.html</code> file you can host anywhere</li>
          <li><strong>Connect a custom domain</strong> — serve the page directly from IgualAI on your own domain</li>
          <li><strong>Push to GitHub</strong> — export to a GitHub repository (Pro/Agency)</li>
        </ul>
      </Section>

      <div className="mt-10 flex gap-4">
        <Link
          href="/docs/ai-editor"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          Next: AI Editor →
        </Link>
      </div>
    </article>
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

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs font-mono text-neutral-700 dark:text-neutral-300">
      {children}
    </kbd>
  )
}
