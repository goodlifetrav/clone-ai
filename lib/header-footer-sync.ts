import { load } from 'cheerio'

export interface HeaderFooter {
  header: string | null
  footer: string | null
  fontLinks: string | null
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

  // Extract Google Font <link> tags and @font-face <style> blocks from <head>
  // so font rendering stays consistent when the header is applied to sibling pages.
  const fontLinkParts: string[] = []
  $('head link[href*="fonts.googleapis.com"], head link[href*="fonts.gstatic.com"]').each((_, el) => {
    fontLinkParts.push($.html(el))
  })
  $('head link[rel="preconnect"][href*="fonts"]').each((_, el) => {
    fontLinkParts.push($.html(el))
  })
  // Also capture any <style> blocks that only contain @font-face rules
  $('head style').each((_, el) => {
    const text = $(el).text()
    if (text.includes('@font-face')) {
      fontLinkParts.push($.html(el))
    }
  })

  return {
    header: headerParts.length ? headerParts.join('\n') : null,
    footer: footerParts.length ? footerParts.join('\n') : null,
    fontLinks: fontLinkParts.length ? fontLinkParts.join('\n') : null,
  }
}

export function applyHeaderFooter(targetHtml: string, source: HeaderFooter): string {
  if (!source.header && !source.footer) return targetHtml

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const $ = load(targetHtml, { xmlMode: false } as any)

  // Inject source font links into <head> if not already present
  if (source.fontLinks) {
    const existingFontHrefs = new Set<string>()
    $('head link[href*="fonts"]').each((_, el) => {
      const href = $(el).attr('href') ?? ''
      if (href) existingFontHrefs.add(href)
    })

    // Parse the font links and inject only missing ones
    const $fonts = load(source.fontLinks)
    $fonts('link, style').each((_, el) => {
      const href = $fonts(el).attr('href') ?? ''
      if (href && existingFontHrefs.has(href)) return
      $('head').append($.html(el as Parameters<typeof $.html>[0]))
    })
  }

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
