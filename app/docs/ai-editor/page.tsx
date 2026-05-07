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
        Three ways to customize your page — AI Chat, Visual Editor, and the Brand Wizard.
      </p>

      <Section title="Brand Wizard">
        <p>
          The Brand Wizard is the fastest way to go from a fresh clone to a launch-ready page.
          It walks you through four inputs — brand identity, colors, content, and your logo —
          then rebuilds the entire page in one shot.
        </p>
        <p>
          The Wizard opens automatically when a clone finishes. You can also re-open it anytime
          by clicking the <strong>Visual</strong> tab before any AI edits have been made.
        </p>
      </Section>

      <Section title="AI Chat">
        <p>
          The chat panel on the left handles two different modes depending on context:
        </p>
        <ul>
          <li>
            <strong>First message</strong> — IgualAI reads the full structure of the cloned page
            and rebuilds it section-by-section as a new brand. Every section from the original
            is preserved; only the content changes.
          </li>
          <li>
            <strong>Follow-up messages</strong> — targeted edits only. The AI touches
            exactly what you ask about and leaves everything else untouched. Ask it to change
            a color, rewrite a section, update the CTA — nothing else moves.
          </li>
        </ul>
        <p>Include specific brand detail for the best results:</p>
        <ul>
          <li>
            <strong>Great:</strong>{' '}
            <em>&ldquo;Build this for a coffee shop called Roast &amp; Co. Warm brown tones, cozy and community-focused. Located in Austin, TX.&rdquo;</em>
          </li>
          <li>
            <strong>Great follow-up:</strong>{' '}
            <em>&ldquo;Change the hero headline to &lsquo;Where Every Cup Tells a Story&rsquo;&rdquo;</em>
          </li>
          <li>
            <strong>Too vague:</strong> <em>&ldquo;Make it look nicer&rdquo;</em>
          </li>
        </ul>
      </Section>

      <Section title="Visual Editor">
        <p>
          After an AI rebuild, the <strong>Visual</strong> tab becomes a live inline editor.
          Click any text on the page to edit it directly — headlines, nav links, button labels,
          paragraphs, anything. Click an image to replace it with a new URL or a seed word for
          a stock photo.
        </p>
        <ul>
          <li>Hover any element to see a highlight — click to start editing</li>
          <li>Press <Kbd>Enter</Kbd> or <Kbd>Esc</Kbd> to save and exit the field</li>
          <li>Click an image → enter a URL or a single word (e.g. <code>coffee</code>) to swap it</li>
          <li>Changes save automatically to your project</li>
        </ul>
        <p>
          The Visual Editor always renders at full desktop width so you see the same layout
          your visitors will.
        </p>
      </Section>

      <Section title="Version History">
        <p>
          Every AI rebuild and manual save creates a version snapshot. Open the{' '}
          <strong>History</strong> tab to browse past versions and restore any of them with one
          click. You can freely experiment without fear of losing your work.
        </p>
      </Section>

      <Section title="Tokens">
        <p>
          Each AI Chat or Brand Wizard generation consumes tokens based on page size and edit
          complexity. Visual Editor changes do not consume tokens. You can check your remaining
          balance in{' '}
          <Link href="/settings" className="text-neutral-900 dark:text-white underline underline-offset-2">
            Account Settings
          </Link>
          .
        </p>
        <p>
          If you run out of tokens mid-month, you can purchase a one-time token pack from the
          Settings page (Pro and Agency plans only).
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
