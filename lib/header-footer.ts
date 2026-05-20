/**
 * Header/footer extraction and replacement utilities.
 */

import { load } from 'cheerio'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the outer HTML of the first element matched by `selector`.
 * Uses `$.html(rawNode)` (not a Cheerio wrapper) which always returns outer HTML.
 */
function outerHtml(html: string, selector: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const $ = load(html, { xmlMode: false } as any)
  const el = $(selector).first()
  if (!el.length) return ''
  // el[0] is the raw CheerioElement — $.html(rawNode) reliably returns outer HTML
  return $.html(el[0]) ?? ''
}

// ── Extraction ────────────────────────────────────────────────────────────────

export function extractHeaderFooter(html: string): { headerHtml: string; footerHtml: string } {
  const announcementHtml = outerHtml(html, '[data-igualai-section="announcement-bar"]')
  const navHtml = outerHtml(html, 'nav')
  const footerHtml = outerHtml(html, 'footer')
  const headerHtml = [announcementHtml, navHtml].filter(Boolean).join('\n')
  console.log(`[header-footer] extracted: ann=${announcementHtml.length}c nav=${navHtml.length}c footer=${footerHtml.length}c`)
  return { headerHtml, footerHtml }
}

// ── Replacement ───────────────────────────────────────────────────────────────

/**
 * Replace the <nav>, announcement bar, and <footer> in targetHtml with the
 * ones found in newHeaderHtml / newFooterHtml.
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
    const srcNav = outerHtml(newHeaderHtml, 'nav')
    const srcAnn = outerHtml(newHeaderHtml, '[data-igualai-section="announcement-bar"]')

    console.log(`[header-footer] inject: srcNav=${srcNav.length}c srcAnn=${srcAnn.length}c pageNavFound=${$page('nav').first().length > 0}`)

    if (srcNav) {
      const $pageNav = $page('nav').first()
      if ($pageNav.length) {
        $pageNav.replaceWith(srcNav)
      }
    }

    if (srcAnn) {
      const $pageAnn = $page('[data-igualai-section="announcement-bar"]').first()
      if ($pageAnn.length) {
        $pageAnn.replaceWith(srcAnn)
      } else {
        $page('nav').first().before(srcAnn)
      }
    }
  }

  if (newFooterHtml) {
    const srcFooter = outerHtml(newFooterHtml, 'footer')
    console.log(`[header-footer] inject footer: srcFooter=${srcFooter.length}c pageFooterFound=${$page('footer').first().length > 0}`)
    if (srcFooter) {
      const $pageFooter = $page('footer').first()
      if ($pageFooter.length) $pageFooter.replaceWith(srcFooter)
    }
  }

  return $page.html() ?? targetHtml
}
