import { load } from 'cheerio'

export interface HeaderFooter {
  header: string | null
  footer: string | null
}

// Extracts the "role" suffix from a Shopify section ID.
// "shopify-section-template--123__announcement-bar" → "announcement-bar"
function sectionRole(id: string): string | null {
  if (!id.startsWith('shopify-section')) return null
  const dunder = id.lastIndexOf('__')
  if (dunder !== -1) return id.slice(dunder + 2).toLowerCase()
  const parts = id.split('-')
  return parts[parts.length - 1].toLowerCase()
}

const HEADER_ROLE_RE = /^(header|announcement|announcement-bar|navigation|nav-bar|top-bar)$/
const FOOTER_ROLE_RE = /^footer/

export function extractHeaderFooter(html: string): HeaderFooter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const $ = load(html, { xmlMode: false } as any)

  const headerParts: string[] = []
  const footerParts: string[] = []

  $('[id^="shopify-section"]').each((_, el) => {
    const role = sectionRole($(el).attr('id') ?? '')
    if (!role) return
    if (HEADER_ROLE_RE.test(role)) {
      headerParts.push($.html(el))
    } else if (FOOTER_ROLE_RE.test(role)) {
      footerParts.push($.html(el))
    }
  })

  // Fallback to semantic landmarks
  if (!headerParts.length) {
    const el = $('header[role="banner"]')
    if (el.length) headerParts.push($.html(el))
  }
  if (!footerParts.length) {
    const el = $('footer[role="contentinfo"]')
    if (el.length) footerParts.push($.html(el))
  }

  return {
    header: headerParts.length ? headerParts.join('\n') : null,
    footer: footerParts.length ? footerParts.join('\n') : null,
  }
}

export function applyHeaderFooter(targetHtml: string, source: HeaderFooter): string {
  if (!source.header && !source.footer) return targetHtml

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const $ = load(targetHtml, { xmlMode: false } as any)

  if (source.header) {
    const els = $('[id^="shopify-section"]').filter((_, el) => {
      const role = sectionRole($(el).attr('id') ?? '')
      return role ? HEADER_ROLE_RE.test(role) : false
    }).toArray()

    if (els.length) {
      $(els[0]).replaceWith(source.header)
      els.slice(1).forEach(el => $(el).remove())
    }
  }

  if (source.footer) {
    const els = $('[id^="shopify-section"]').filter((_, el) => {
      const role = sectionRole($(el).attr('id') ?? '')
      return role ? FOOTER_ROLE_RE.test(role) : false
    }).toArray()

    if (els.length) {
      $(els[0]).replaceWith(source.footer)
      els.slice(1).forEach(el => $(el).remove())
    }
  }

  return $.html()
}
