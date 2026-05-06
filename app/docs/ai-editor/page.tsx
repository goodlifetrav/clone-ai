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
          right. When you send a message, IgualAI reads the full HTML of your page, applies your
          requested change, and streams the updated page back in real time.
        </p>
        <p>
          Every edit is applied directly to the HTML — no framework, no build step.
        </p>
      </Section>

      <Section title="What you can change">
        <p>You can ask for almost anything:</p>
        <ul>
          <li>Text content — headlines, body copy, button labels, footer text</li>
          <li>Colors — backgrounds, text, borders, gradients</li>
          <li>Layout — spacing, columns, section order, alignment</li>
          <li>Components — add a contact form, pricing table, image gallery, CTA section</li>
          <li>Fonts — change typeface, size, weight</li>
          <li>Images — swap placeholder images with a URL or remove them</li>
          <li>Animations — add hover effects, fade-ins, transitions</li>
        </ul>
      </Section>

      <Section title="Prompt tips">
        <p>Be specific for best results:</p>
        <ul>
          <li>
            <strong>Good:</strong>{' '}
            <em>"Change the hero background to a dark gradient from #0f172a to #1e293b"</em>
          </li>
          <li>
            <strong>Good:</strong>{' '}
            <em>"Replace the nav links with: Home, About, Pricing, Contact"</em>
          </li>
          <li>
            <strong>Less effective:</strong> <em>"Make it look nicer"</em>
          </li>
        </ul>
        <p>
          You can also ask questions:{' '}
          <em>"What font is currently used for the headline?"</em> — the AI has full context of
          your page.
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
