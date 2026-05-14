import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Shopify Integration — IgualAI Docs',
  description: 'Push your cloned site to Shopify as a theme using a Custom App token.',
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

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-900 dark:text-amber-200 mb-6">
      {children}
    </div>
  )
}

export default function ShopifyIntegrationPage() {
  return (
    <article className="max-w-none">
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-2">Shopify Integration</h1>
      <p className="text-neutral-500 dark:text-neutral-400 mt-0 mb-8 text-base">
        Push your cloned site to Shopify as an unpublished theme in a few steps.
      </p>

      <Callout>
        This integration requires a <strong>Pro plan or above</strong>. The theme is created as
        unpublished so it won&apos;t affect your live store until you choose to publish it.
      </Callout>

      <h2 className="text-xl font-bold text-neutral-900 dark:text-white mt-8 mb-4">
        How to get your Admin API token
      </h2>

      <Step n={1} title="Open your Shopify admin">
        <p>
          Go to <strong>your-store.myshopify.com/admin</strong> and log in.
        </p>
      </Step>

      <Step n={2} title="Go to Settings → Apps and sales channels">
        <p>
          Click <strong>Settings</strong> in the bottom-left corner, then select{' '}
          <strong>Apps and sales channels</strong> from the menu.
        </p>
      </Step>

      <Step n={3} title="Open the Develop apps section">
        <p>
          At the top of the page click <strong>Develop apps</strong>. If prompted, click{' '}
          <strong>Allow custom app development</strong> to enable it for your store.
        </p>
      </Step>

      <Step n={4} title="Create a new app">
        <p>
          Click <strong>Create an app</strong>. Give it any name — for example{' '}
          <em>IgualAI</em> — then click <strong>Create app</strong>.
        </p>
      </Step>

      <Step n={5} title="Configure Admin API scopes">
        <p>
          Inside your new app, click the <strong>Configuration</strong> tab, then click{' '}
          <strong>Configure</strong> under <em>Admin API integration</em>.
        </p>
        <p>
          Search for <strong>Themes</strong> and enable:
        </p>
        <ul>
          <li><code>write_themes</code></li>
          <li><code>read_themes</code></li>
        </ul>
        <p>Click <strong>Save</strong>.</p>
      </Step>

      <Step n={6} title="Install the app">
        <p>
          Click the <strong>API credentials</strong> tab, then click{' '}
          <strong>Install app</strong> and confirm. This generates your token.
        </p>
      </Step>

      <Step n={7} title="Copy your Admin API access token">
        <p>
          Under <em>Admin API access token</em>, click <strong>Reveal token once</strong> and
          copy it. It starts with <code>shpat_</code>. Store it somewhere safe — Shopify only
          shows it once.
        </p>
      </Step>

      <h2 className="text-xl font-bold text-neutral-900 dark:text-white mt-10 mb-4">
        Pushing your clone to Shopify
      </h2>

      <p className="text-[15px] text-neutral-600 dark:text-neutral-300 mb-4">
        Once you have your token, open any project in the editor:
      </p>

      <ol className="list-decimal pl-5 space-y-2 text-[15px] text-neutral-600 dark:text-neutral-300 mb-8">
        <li>Click the <strong>Export</strong> button in the top toolbar.</li>
        <li>Select <strong>Shopify</strong>.</li>
        <li>
          Enter your <strong>Store URL</strong> (e.g. <code>mystore.myshopify.com</code> — no{' '}
          <code>https://</code> needed).
        </li>
        <li>Paste your <strong>Admin API Access Token</strong>.</li>
        <li>Click <strong>Push to Shopify</strong>.</li>
      </ol>

      <p className="text-[15px] text-neutral-600 dark:text-neutral-300 mb-2">
        IgualAI will create a new unpublished theme in your store. You&apos;ll get two links:
      </p>
      <ul className="mb-8">
        <li><strong>Open Theme Editor</strong> — customize it inside Shopify.</li>
        <li><strong>Preview Theme</strong> — see how it looks before publishing.</li>
      </ul>

      <Callout>
        <strong>Ready to go live?</strong> In your Shopify admin go to{' '}
        <strong>Online Store → Themes</strong>, find the IgualAI theme, and click{' '}
        <strong>Publish</strong>.
      </Callout>
    </article>
  )
}
