/**
 * Header/footer extraction and replacement utilities.
 *
 * Extracts source nav/announcement/footer via Cheerio.
 * Injects into target pages using element-level replacement so the
 * result is always structurally correct regardless of Gemini's layout.
 */

import { load } from 'cheerio'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the outer HTML of the first element matched by selector. */
function outerHtml(html: string, selector: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const $ = load(html, { xmlMode: false } as any)
  const el = $(selector).first()
  if (!el.length) return ''
  // Cheerio's $.html(collection) returns outer HTML of the collection.
  return $.html(el) ?? ''
}

// ── Extraction ────────────────────────────────────────────────────────────────

export function extractHeaderFooter(html: string): { headerHtml: string; footerHtml: string } {
  const announcementHtml = outerHtml(html, '[data-igualai-section="announcement-bar"]')
  const navHtml = outerHtml(html, 'nav')
  const footerHtml = outerHtml(html, 'footer')
  const headerHtml = [announcementHtml, navHtml].filter(Boolean).join('\n')
  return { headerHtml, footerHtml }
}

// ── Replacement ───────────────────────────────────────────────────────────────

/**
 * Replace the nav, announcement bar, and footer in targetHtml with the ones
 * found in newHeaderHtml / newFooterHtml.
 */
export function replaceHeaderFooter(
  targetHtml: string,
  newHeaderHtml: string,
  newFooterHtml: string
): string {
  if (!newHeaderHtml && !newFooterHtml) return targetHtml

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const $page = load(targetHtml, { xmlMode: false } as any)

  if (newHeaderHtml) {
    // Extract source elements as raw HTML strings
    const srcNav = outerHtml(newHeaderHtml, 'nav')
    const srcAnn = outerHtml(newHeaderHtml, '[data-igualai-section="announcement-bar"]')

    if (srcNav) {
      const $pageNav = $page('nav').first()
      if ($pageNav.length) $pageNav.replaceWith(srcNav)
    }

    if (srcAnn) {
      const $pageAnn = $page('[data-igualai-section="announcement-bar"]').first()
      if ($pageAnn.length) {
        $pageAnn.replaceWith(srcAnn)
      } else {
        // Insert before nav if target has no announcement bar
        $page('nav').first().before(srcAnn)
      }
    }
  }

  if (newFooterHtml) {
    const srcFooter = outerHtml(newFooterHtml, 'footer')
    if (srcFooter) {
      const $pageFooter = $page('footer').first()
      if ($pageFooter.length) $pageFooter.replaceWith(srcFooter)
    }
  }

  return $page.html() ?? targetHtml
}
