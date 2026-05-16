import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'FAQ — IgualAI Docs',
  description: 'Frequently asked questions about IgualAI — cloning, Shopify, brand rebuild, folders, and more.',
}

const FAQS = [
  {
    q: 'What can IgualAI clone?',
    a: 'Any publicly accessible website, Shopify store, sales funnel, landing page, or sales page. Paste the URL and IgualAI captures and rebuilds it as clean, editable HTML in seconds. Sites behind a login or paywall may not clone fully.',
  },
  {
    q: 'Can I clone a Shopify store?',
    a: "Yes — including the homepage, product pages, and collection pages. IgualAI automatically detects the page type from the URL and configures the right Shopify template. Product pages use Shopify Liquid variables ({{ product.title }}, {{ product.price | money }}, add-to-cart form) so the actual product data comes from your catalog live.",
  },
  {
    q: 'What is a folder?',
    a: "A folder groups all the pages of one website together. Set up your brand once on any page in a folder — the brand name, colors, description, and logo are saved to the folder and auto-fill on every other page in it. When you push to Shopify, all pages in the folder go into one theme automatically.",
  },
  {
    q: 'How do I share brand settings across multiple pages?',
    a: "Add all pages of the same site to one folder. Open the Brand Wizard on any page in that folder and fill in your brand info — it saves immediately. Open the Brand Wizard on any other page in the same folder and all fields are pre-filled. You never have to enter your brand twice.",
  },
  {
    q: 'What is the Brand Wizard?',
    a: "The Brand Wizard is a guided 3-step setup that opens from the editor toolbar. It collects your brand identity (name, tagline, logo, description), brand colors (primary, secondary, accent), and page-specific copy. For homepages that's a hero headline, subheadline, and CTA. For product pages that's an optional product name and description. The AI then rebuilds the entire page with your brand's identity while keeping the original page's layout as the structural blueprint.",
  },
  {
    q: 'How does the Shopify push work?',
    a: "IgualAI converts your rebuilt HTML into a proper Shopify Online Store 2.0 theme. Each section becomes a Liquid section file with a {% schema %} block — making every heading, color, image, and button editable inside the Shopify theme editor, just like a natively built theme. You can push a single page or push an entire folder (all pages as one theme) from the folder's … menu on the dashboard.",
  },
  {
    q: 'What Shopify page types are supported?',
    a: "Homepage (index.json), Product pages (product.json with {{ product.title }}, {{ product.price | money }}, variant selector, add-to-cart form), and Collection pages (collection.json). 404 and password pages are also included automatically.",
  },
  {
    q: 'Can I edit sections after pushing to Shopify?',
    a: "Yes. Every section IgualAI pushes is fully editable in the Shopify theme editor — background color, text color, all text content, and the header logo. Product sections pull live data from your Shopify catalog automatically.",
  },
  {
    q: 'Will the clone look exactly like the original?',
    a: "The initial clone captures the layout and design of the page. The intended workflow is to then use the Brand Wizard to transform it into a completely original page for your brand — replacing all content, colors, and copy while preserving the page structure. Your final site is 100% original and copyright-safe.",
  },
  {
    q: 'Is cloning websites legal?',
    a: "IgualAI is designed for brand transformation — you clone a layout and structure, then rebuild it as something entirely new for your business. The output is an original page inspired by a layout, not a copy of anyone's content. You are responsible for your use of the tool. Do not republish copyrighted content as your own. See our Acceptable Use Policy for details.",
  },
  {
    q: 'Can I clone a website I own?',
    a: "Yes — many users clone their own existing sites to rapidly prototype a redesign, create landing page variants, or migrate to a new brand identity.",
  },
  {
    q: 'Why did my clone fail or look broken?',
    a: "Some sites block automated access, use heavy client-side rendering (JavaScript-rendered carousels, product sliders), or serve different content to non-human visitors. Try re-cloning. If it still fails or looks incomplete, the site's rendering approach may be incompatible with our current capture pipeline.",
  },
  {
    q: 'Why are some sections empty in my Shopify clone?',
    a: "The clone is a layout blueprint, not a live copy. Shopify product carousels (New Arrivals, Recommendations, Others Also Bought) load product data via authenticated API calls that can't be replicated in a static clone — so those sections will appear empty. This is expected behavior. The Brand Rebuild step replaces all section content with your brand anyway, using the cloned layout purely as a structural guide. The final rebuilt page is 100% original.",
  },
  {
    q: 'What is the Visual Editor?',
    a: "After any AI rebuild, the Visual tab becomes a live editor. Click directly on any text — headlines, nav links, buttons, paragraphs — to edit it inline without writing a prompt. Click any image to swap it with a new URL. Changes save automatically.",
  },
  {
    q: "What's the difference between the first AI chat message and follow-up messages?",
    a: "The first message triggers a full brand rebuild — IgualAI reads the entire page structure and regenerates every section with your brand's content and styling. Follow-up messages are targeted edits: the AI changes only what you specifically ask for and leaves everything else exactly as it is.",
  },
  {
    q: 'Do Visual Editor changes use tokens?',
    a: "No. Inline text and image edits in the Visual Editor are free and do not consume tokens. Only AI Chat and Brand Wizard generations use tokens.",
  },
  {
    q: 'What happens to my pages if I cancel my plan?',
    a: "Your projects remain accessible. You'll be downgraded to the Free plan limits but won't lose any existing clones. Custom domains will continue to work until you remove them.",
  },
  {
    q: 'How do I get a refund?',
    a: "Email support@igualai.com within 7 days of your charge. We'll review on a case-by-case basis.",
  },
  {
    q: 'Can I use IgualAI for client work?',
    a: "Yes. The Agency plan is designed for agencies and freelancers who need to rapidly prototype or deliver sites for multiple clients.",
  },
  {
    q: 'Does IgualAI support images from the original site?',
    a: "Images from the cloned site are preserved as external references. If the original site blocks hotlinking, images may not display. For permanent hosting, download the page and re-host images on your own server.",
  },
]

export default function FaqPage() {
  return (
    <article className="max-w-none">
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-2">
        Frequently Asked Questions
      </h1>
      <p className="text-neutral-500 dark:text-neutral-400 mt-0 mb-8 text-base">
        Can&apos;t find your answer?{' '}
        <a href="mailto:support@igualai.com" className="text-neutral-900 dark:text-white underline underline-offset-2">
          Email support
        </a>
        .
      </p>

      <div className="space-y-4 not-prose">
        {FAQS.map(({ q, a }) => (
          <div
            key={q}
            className="border border-neutral-200 dark:border-neutral-700 rounded-xl p-5"
          >
            <h3 className="text-[15px] font-semibold text-neutral-900 dark:text-white mb-2">{q}</h3>
            <p className="text-[15px] text-neutral-600 dark:text-neutral-300 leading-relaxed m-0">{a}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex gap-4">
        <Link
          href="/docs/shopify-integration"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          ← Shopify Integration
        </Link>
        <Link
          href="/docs/plans-tokens"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          Plans & Tokens →
        </Link>
      </div>
    </article>
  )
}
