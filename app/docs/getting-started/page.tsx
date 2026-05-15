import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Getting Started — IgualAI Docs',
  description: 'Clone any website, Shopify store, funnel, or sales page and rebuild it as your brand in minutes.',
}

export default function GettingStartedPage() {
  return (
    <article className="max-w-none">
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-2">Getting Started</h1>
      <p className="text-neutral-500 dark:text-neutral-400 mt-0 mb-8 text-base">
        Clone any page, rebuild it as your brand, and push it live — in minutes.
      </p>

      <Section title="1. Paste a URL and clone">
        <p>
          Go to{' '}
          <Link href="/" className="text-neutral-900 dark:text-white font-medium underline underline-offset-2">
            igualai.com
          </Link>{' '}
          and paste any public URL — a website, Shopify store homepage, product page, funnel, or sales page. Press{' '}
          <Kbd>Enter</Kbd> or click <strong>Clone</strong>.
        </p>
        <p>
          IgualAI captures the page using a proprietary pipeline and reconstructs it as a clean,
          self-contained HTML file. This typically completes in 5–15 seconds.
        </p>
      </Section>

      <Section title="2. Add the page to a folder">
        <p>
          Folders are how IgualAI groups all the pages of one website together. When you add a page
          to a folder, any brand settings you configure are automatically shared with every other
          page in that folder — no re-entering required.
        </p>
        <ul>
          <li>From the dashboard, drag your project into an existing folder or create a new one.</li>
          <li>You can also create or assign a folder directly inside the Brand Wizard on step 1.</li>
        </ul>
        <Callout>
          <strong>Tip:</strong> Name your folder after the site you cloned — e.g. <em>"Death Wish Coffee"</em> or{' '}
          <em>"Wild Craft"</em>. When you push to Shopify, all pages in the folder go into one theme automatically.
        </Callout>
      </Section>

      <Section title="3. Open the Brand Wizard and rebuild">
        <p>
          Click <strong>AI Brand Rebuild</strong> in the editor toolbar. The Brand Wizard walks you through three steps:
        </p>
        <ul>
          <li>
            <strong>Brand Identity</strong> — brand name, tagline, logo URL, and a description of your business and audience.
            If this page is in a folder, the wizard checks for a saved brand and pre-fills all fields automatically.
          </li>
          <li>
            <strong>Colors</strong> — primary, secondary, and accent colors. These drive navbars, section backgrounds, buttons, and highlights.
          </li>
          <li>
            <strong>Content</strong> (homepage only) — hero headline, subheadline, and CTA button text. Leave blank to auto-generate from your brand description.
          </li>
          <li>
            <strong>Product Details</strong> (product pages only) — optional product name and description to help the AI style supporting sections around the product.
          </li>
        </ul>
        <p>
          Hit <strong>Rebuild with AI</strong>. IgualAI uses the cloned page&apos;s layout as a structural blueprint
          and regenerates every section with your brand&apos;s identity, copy, colors, and imagery.
        </p>
      </Section>

      <Section title="4. Clone more pages into the same folder">
        <p>
          Go back to the homepage and clone your next page — a product page, collection page, or any other URL.
          Add it to the same folder. When you open the Brand Wizard on that page, all your brand info is already
          filled in. Just hit Rebuild.
        </p>
        <p>
          Repeat for as many pages as you need. Each page is a separate project but they all share the same brand.
        </p>
      </Section>

      <Section title="5. Fine-tune with AI Chat or Visual Editor">
        <p>
          After rebuilding, you have two ways to keep refining:
        </p>
        <ul>
          <li>
            <strong>AI Chat</strong> — describe what you want changed in plain English.
            Follow-up messages make targeted edits without touching anything you didn&apos;t ask about.
          </li>
          <li>
            <strong>Visual Editor</strong> — click directly on any text or image in the preview to
            edit it inline. No prompts needed — just click, type, and save.
          </li>
        </ul>
      </Section>

      <Section title="6. Export or deploy">
        <p>
          When you&apos;re happy with your pages, you can:
        </p>
        <ul>
          <li><strong>Download</strong> — get a self-contained <code>.html</code> file you can host anywhere.</li>
          <li><strong>Connect a custom domain</strong> — serve the page directly from IgualAI on your own domain.</li>
          <li><strong>Push to GitHub</strong> — export to a GitHub repository (Pro/Agency plans).</li>
          <li>
            <strong>Push to Shopify</strong> — export as a fully structured Shopify theme. Push a single page or
            push an entire folder as one theme in one click.{' '}
            <Link href="/docs/shopify-integration" className="text-neutral-900 dark:text-white underline underline-offset-2">
              See the Shopify guide →
            </Link>
          </li>
        </ul>
      </Section>

      <div className="mt-10 flex gap-4 flex-wrap">
        <Link
          href="/docs/shopify-integration"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          Next: Shopify Integration →
        </Link>
        <Link
          href="/docs/ai-editor"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          AI Editor →
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

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-900 dark:text-amber-200 my-3">
      {children}
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-xs font-mono text-neutral-700 dark:text-neutral-300">
      {children}
    </kbd>
  )
}
