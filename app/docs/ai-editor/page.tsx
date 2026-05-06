import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'AI Editor — IgualAI Docs',
  description: 'Learn how to use the AI chat editor to customize your cloned website.',
}

export default function AiEditorPage() {
  return (
    <article className="max-w-none">
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-white mb-2">AI Editor</h1>
      <p className="text-neutral-500 dark:text-neutral-400 mt-0 mb-8 text-base">
        Customize any part of your clone using plain English.
      </p>

      <Section title="How it works">
        <p>
          The editor splits into two panels: the AI chat on the left and a live preview on the
          right. When you send a message, IgualAI uses the cloned page&apos;s layout as a structural
          template and builds a completely new, original website based on your brand description —
          streaming the result back in real time.
        </p>
        <p>
          Every edit produces a fresh, self-contained HTML file — no framework, no build step,
          no trace of the original site&apos;s content or branding.
        </p>
      </Section>

      <Section title="What the AI does">
        <p>
          The AI uses the cloned site&apos;s layout structure (sections, navigation pattern, content
          hierarchy) and replaces everything else with original content tailored to your brand:
        </p>
        <ul>
          <li>Brand name, tagline, and all copy — written fresh for your business</li>
          <li>Color scheme — matched to your brand colors</li>
          <li>Typography — fonts and styles appropriate for your industry</li>
          <li>Images — replaced with brand-appropriate placeholders or your uploaded images</li>
          <li>Sections — same structure as the original (hero, features, testimonials, footer)</li>
        </ul>
      </Section>

      <Section title="Prompt tips">
        <p>Include as much brand context as possible for the best result:</p>
        <ul>
          <li>
            <strong>Great:</strong>{' '}
            <em>"Build this for a coffee shop called Roast & Co. Warm brown tones, focus on quality and community. Located in Austin, TX."</em>
          </li>
          <li>
            <strong>Great:</strong>{' '}
            <em>"Redesign for a B2B SaaS called Flowdesk. Navy and white, professional, targets HR teams."</em>
          </li>
          <li>
            <strong>Too vague:</strong> <em>"Make it look nicer"</em>
          </li>
        </ul>
        <p>
          The more detail you give — industry, audience, colors, tone — the more accurate and
          polished the output will be.
        </p>
      </Section>

      <Section title="Versions">
        <p>
          Every time you save or the AI makes a significant change, a version snapshot is created.
          You can view and restore previous versions from the editor toolbar. This means you can
          freely experiment without fear of losing your work.
        </p>
      </Section>

      <Section title="Tokens">
        <p>
          Each AI edit consumes tokens. The token count depends on the size of your page and the
          complexity of the change. Larger pages with many edits will use more tokens. You can see
          your remaining tokens in{' '}
          <Link href="/settings" className="text-neutral-900 dark:text-white underline underline-offset-2">
            Account Settings
          </Link>
          .
        </p>
        <p>
          If you run out of tokens mid-month, you can buy a one-time token pack from the Settings
          page (Pro and Agency plans only).
        </p>
      </Section>

      <div className="mt-10 flex gap-4">
        <Link
          href="/docs/getting-started"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          ← Getting Started
        </Link>
        <Link
          href="/docs/custom-domains"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-700 rounded-lg px-4 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors no-underline"
        >
          Next: Custom Domains →
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
