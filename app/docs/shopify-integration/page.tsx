import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Shopify Integration — IgualAI Docs',
  description: 'Clone any Shopify store, rebuild it with your brand, and push it as a fully structured Shopify theme.',
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 mb-6">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-green-600 text-white text-sm font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <div>
        <h3 className="font-semibold text-neutral-900 dark:text-white text-[15px] mb-1">{title}</h3>
        <div className="text-[15px] text-neutral-600 dark:text-neutral-300 space-y-2">{children}</div>
      </div>
    </div>
  )
}

function Callout({ type = 'info', children }: { type?: 'info' | 'tip' | 'warning'; children: React.ReactNode }) {
  const styles = {
    info: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200',
    tip: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200',
    warning: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200',
  }
  return (
    <div className={`border rounded-lg px-4 py-3 text-sm mb-6 ${styles[type]}`}>
      {children}
    </div>
  )
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xl font-bold text-neutral-900 dark:text-white mt-10 mb-4">{children}</h2>
  )
}

export default function ShopifyIntegrationPage() {
  return (
    <article className="max-w-none">
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-2">Shopify Integration</h1>
      <p className="text-neutral-500 dark:text-neutral-400 mt-0 mb-8 text-base">
        Clone any Shopify store, rebuild every page with your brand, and push the whole site as a fully
        structured Shopify theme — complete with Liquid sections, color pickers in the Shopify editor,
        and live product data.
      </p>

      <Callout type="tip">
        The Shopify integration requires a <strong>Pro plan or above</strong>. Themes are created as
        unpublished so they won&apos;t affect your live store until you choose to publish them.
      </Callout>

      <H2>Overview — how it works</H2>

      <p className="text-[15px] text-neutral-600 dark:text-neutral-300 mb-6 leading-relaxed">
        IgualAI converts your rebuilt HTML pages into proper Shopify Online Store 2.0 JSON templates.
        Each section of your page becomes a Shopify section with a <code>{'{% schema %}'}</code> block —
        meaning every text, color, and image is editable inside the Shopify theme editor, just like a
        natively built theme.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 not-prose">
        {[
          { label: 'Homepage', detail: 'index.json template' },
          { label: 'Product Pages', detail: 'product.json + Liquid variables' },
          { label: 'Collection Pages', detail: 'collection.json template' },
        ].map(({ label, detail }) => (
          <div key={label} className="border border-neutral-200 dark:border-neutral-700 rounded-xl p-4">
            <p className="font-semibold text-neutral-900 dark:text-white text-sm mb-1">{label}</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{detail}</p>
          </div>
        ))}
      </div>

      <H2>Step 1 — Get your Shopify Admin API token</H2>

      <Step n={1} title="Open your Shopify admin">
        <p>Go to <strong>your-store.myshopify.com/admin</strong> and log in.</p>
      </Step>

      <Step n={2} title="Go to Settings → Apps and sales channels">
        <p>Click <strong>Settings</strong> in the bottom-left, then select <strong>Apps and sales channels</strong>.</p>
      </Step>

      <Step n={3} title="Open the Develop apps section">
        <p>
          At the top of the page click <strong>Develop apps</strong>. If prompted, click{' '}
          <strong>Allow custom app development</strong>.
        </p>
      </Step>

      <Step n={4} title="Create a new app">
        <p>
          Click <strong>Create an app</strong>. Name it anything — e.g. <em>IgualAI</em> — then click <strong>Create app</strong>.
        </p>
      </Step>

      <Step n={5} title="Configure Admin API scopes">
        <p>Inside your new app, click <strong>Configuration</strong> → <strong>Configure</strong> under Admin API integration.</p>
        <p>Search for <strong>Themes</strong> and enable:</p>
        <ul>
          <li><code>write_themes</code></li>
          <li><code>read_themes</code></li>
        </ul>
        <p>Click <strong>Save</strong>.</p>
      </Step>

      <Step n={6} title="Install the app and copy your token">
        <p>
          Click the <strong>API credentials</strong> tab → <strong>Install app</strong> → confirm.
          Under <em>Admin API access token</em>, click <strong>Reveal token once</strong> and copy it.
          It starts with <code>shpat_</code>. Save it somewhere safe — Shopify only shows it once.
        </p>
      </Step>

      <H2>Step 2 — Clone and rebuild your pages</H2>

      <p className="text-[15px] text-neutral-600 dark:text-neutral-300 mb-4 leading-relaxed">
        Before pushing to Shopify, rebuild your pages with your brand using the Brand Wizard.
        IgualAI automatically detects what type of page each URL is:
      </p>

      <div className="not-prose space-y-3 mb-6">
        {[
          {
            type: 'Homepage',
            url: 'yourstore.com',
            note: 'Full 3-step brand wizard including hero headline, subheadline, and CTA copy.',
          },
          {
            type: 'Product page',
            url: 'yourstore.com/products/product-name',
            note: 'Brand wizard includes a Product Details step — add the product name and description to help the AI style supporting sections. The actual product title, price, and add-to-cart are powered by Shopify Liquid and pull live data from your catalog.',
          },
          {
            type: 'Collection page',
            url: 'yourstore.com/collections/collection-name',
            note: 'Brand wizard uses your brand identity and colors. Product listings are rendered by Shopify Liquid from your catalog.',
          },
        ].map(({ type, url, note }) => (
          <div key={type} className="border border-neutral-200 dark:border-neutral-700 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-neutral-900 dark:text-white">{type}</span>
              <code className="text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">{url}</code>
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">{note}</p>
          </div>
        ))}
      </div>

      <H2>Step 3 — Group pages in a folder</H2>

      <p className="text-[15px] text-neutral-600 dark:text-neutral-300 mb-4 leading-relaxed">
        Folders are the key to pushing multiple pages as one Shopify theme. Group all the pages of
        one store together — homepage, product pages, collection pages — into a single folder.
      </p>

      <ul className="text-[15px] text-neutral-600 dark:text-neutral-300 space-y-2 mb-4">
        <li>From the dashboard, drag projects into a folder or create one from the sidebar.</li>
        <li>You can also create or assign a folder directly in step 1 of the Brand Wizard without leaving the editor.</li>
        <li>Set up your brand on the homepage once — every other page in the folder pre-fills automatically.</li>
      </ul>

      <Callout type="tip">
        <strong>Name the folder after the store</strong> — e.g. <em>&quot;Wild Craft&quot;</em>. When you push the folder to
        Shopify, all pages go into a theme named after the folder.
      </Callout>

      <H2>Step 4 — Push to Shopify</H2>

      <p className="text-[15px] text-neutral-600 dark:text-neutral-300 mb-4 leading-relaxed">
        You have two ways to push:
      </p>

      <div className="not-prose space-y-4 mb-8">
        <div className="border border-neutral-200 dark:border-neutral-700 rounded-xl p-5">
          <p className="font-semibold text-neutral-900 dark:text-white text-sm mb-2">Push a single page</p>
          <ol className="text-sm text-neutral-600 dark:text-neutral-300 space-y-1.5 list-decimal pl-4">
            <li>Open any project in the editor.</li>
            <li>Click <strong>Export</strong> in the top toolbar → select <strong>Shopify</strong>.</li>
            <li>Enter your store URL (e.g. <code>mystore.myshopify.com</code> — no <code>https://</code>).</li>
            <li>Paste your Admin API Access Token.</li>
            <li>Click <strong>Push to Shopify</strong>.</li>
          </ol>
        </div>

        <div className="border-2 border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <p className="font-semibold text-neutral-900 dark:text-white text-sm">Push an entire folder (recommended)</p>
            <span className="text-xs bg-purple-600 text-white px-2 py-0.5 rounded-full font-medium">Recommended</span>
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-3">
            Sends all completed pages in the folder as a single Shopify theme. All templates, sections,
            assets, and required theme files (404, password page, locales) are included automatically.
          </p>
          <ol className="text-sm text-neutral-600 dark:text-neutral-300 space-y-1.5 list-decimal pl-4">
            <li>From the dashboard, open the folder&apos;s <strong>…</strong> menu.</li>
            <li>Select <strong>Push to Shopify</strong>.</li>
            <li>Enter your store URL and Admin API token.</li>
            <li>Click <strong>Push All Pages</strong>.</li>
          </ol>
        </div>
      </div>

      <p className="text-[15px] text-neutral-600 dark:text-neutral-300 mb-2">
        After pushing, IgualAI returns two links:
      </p>
      <ul className="text-[15px] text-neutral-600 dark:text-neutral-300 mb-8 space-y-1">
        <li><strong>Open Theme Editor</strong> — customize sections, colors, and content inside Shopify.</li>
        <li><strong>Preview Theme</strong> — see how the theme looks before publishing.</li>
      </ul>

      <H2>Step 5 — Customize in the Shopify theme editor</H2>

      <p className="text-[15px] text-neutral-600 dark:text-neutral-300 mb-4 leading-relaxed">
        Every section pushed by IgualAI is fully editable inside Shopify&apos;s theme editor. You can:
      </p>
      <ul className="text-[15px] text-neutral-600 dark:text-neutral-300 space-y-2 mb-6">
        <li>Change section background and text colors with the built-in color pickers.</li>
        <li>Edit all text content — headings, paragraphs, button labels.</li>
        <li>Swap the header logo using the image picker.</li>
        <li>Reorder, hide, or remove sections.</li>
        <li>See live product data (title, price, variants, add-to-cart) on product pages automatically.</li>
      </ul>

      <H2>Step 6 — Publish when ready</H2>

      <p className="text-[15px] text-neutral-600 dark:text-neutral-300 mb-4">
        In your Shopify admin go to <strong>Online Store → Themes</strong>, find the IgualAI theme, and click{' '}
        <strong>Publish</strong>. Your store is live.
      </p>

      <Callout type="warning">
        <strong>Theme limit:</strong> Shopify allows a maximum of 20 themes per store. If you hit the limit,
        archive or delete an unused theme in your Shopify admin and try again.
      </Callout>

      <H2>What gets generated</H2>

      <div className="not-prose overflow-x-auto mb-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 dark:border-neutral-700">
              <th className="text-left py-2 pr-4 font-semibold text-neutral-900 dark:text-white">File</th>
              <th className="text-left py-2 font-semibold text-neutral-900 dark:text-white">Purpose</th>
            </tr>
          </thead>
          <tbody className="text-neutral-600 dark:text-neutral-300">
            {[
              ['layout/theme.liquid', 'Global layout — header, footer, CSS variables for brand colors'],
              ['templates/index.json', 'Homepage template — references all homepage sections'],
              ['templates/product.json', 'Product template — includes product-main Liquid section'],
              ['templates/collection.json', 'Collection template — includes collection sections'],
              ['templates/404.json', '404 page'],
              ['templates/password.json', 'Coming soon / password page'],
              ['sections/igualai-header.liquid', 'Header with logo image picker, nav links, announcement bar'],
              ['sections/igualai-footer.liquid', 'Footer with links and copy'],
              ['sections/*.liquid', 'One file per content section — hero, product grid, features, etc.'],
              ['assets/style.css', 'Global styles merged from all pages'],
              ['locales/en.default.json', 'Required Shopify locales file'],
            ].map(([file, purpose]) => (
              <tr key={file} className="border-b border-neutral-100 dark:border-neutral-800">
                <td className="py-2 pr-4 font-mono text-xs">{file}</td>
                <td className="py-2 text-[13px]">{purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10 flex gap-4 flex-wrap">
        <Link
          href="/docs/getting-started"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          ← Getting Started
        </Link>
        <Link
          href="/docs/faq"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          FAQ →
        </Link>
      </div>
    </article>
  )
}
