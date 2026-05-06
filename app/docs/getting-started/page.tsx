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
          IgualAI uses headless Chromium to visit the page, take a full-page screenshot, and
          extract the HTML. IgualAI then reconstructs it as a clean, self-contained HTML file
          with all styles inlined — no external dependencies.
        </p>
      </Section>

      <Section title="2. Review the clone">
        <p>
          Once processing finishes (usually 5–15 seconds), you'll be taken to the editor with a
          live preview of your cloned page on the right and an AI chat panel on the left.
        </p>
        <p>
          The clone is a faithful visual replica. Complex JavaScript interactions won't be
          replicated, but the layout, colors, fonts, and content will be.
        </p>
      </Section>

      <Section title="3. Transform with AI">
        <p>
          Describe your brand in the chat panel and the AI will rebuild the page as a completely
          new, original website using the cloned layout as a template. For example:
        </p>
        <ul>
          <li><em>"Build this for a coffee shop called Roast & Co. Warm brown tones, cozy and community-focused."</em></li>
          <li><em>"Redesign this for a fitness app called PeakFit. Bold, energetic, orange and black."</em></li>
          <li><em>"Make this a landing page for a creative agency called Studio North. Minimal, dark, modern."</em></li>
        </ul>
        <p>
          The more brand detail you provide — name, colors, tone, industry — the better the result.
          The AI replaces all original content with fresh copy and styling while keeping the same
          page structure and sections.
        </p>
      </Section>

      <Section title="4. Download or deploy">
        <p>
          When you're happy with the result, you can:
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
