import { load } from 'cheerio'

// Scripts that control visual layout are kept; everything else is removed.
const KEEP_SCRIPT_RE = /carousel|slider|swiper|splide|glide|tabs|accordion|toggle|modal|lightbox|fancybox/i

// Scripts with these patterns in src are always removed (even if they look visual).
const TRACKING_SRC_RE = /track|analytics|pixel|gtm[\./]|\/gtag|ga\.(js|min)|fbq|hotjar|mixpanel|segment|amplitude|klaviyo|intercom|crisp|drift/i

/**
 * cleanHtml — strip noise from a cloned page:
 *  - Analytics / tracking scripts
 *  - Non-essential scripts (keep visual-layout scripts: carousels, tabs, etc.)
 *  - Canonical <link> and robots/googlebot <meta> tags
 *  - Adds <base target="_blank"> so remaining links open in new tabs
 */
export function cleanHtml(html: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const $ = load(html, { xmlMode: false } as any)

  $('script').each((_, el) => {
    const src = $(el).attr('src') ?? ''
    const inline = $(el).html() ?? ''

    // Always remove tracking/analytics scripts by src
    if (TRACKING_SRC_RE.test(src)) {
      $(el).remove()
      return
    }

    // Keep scripts that drive visual layout widgets
    if (KEEP_SCRIPT_RE.test(src) || KEEP_SCRIPT_RE.test(inline)) {
      return
    }

    // Remove everything else
    $(el).remove()
  })

  // Remove SEO / crawl-directive tags that serve no purpose in a standalone clone
  $('link[rel="canonical"]').remove()
  $('meta[name="robots"]').remove()
  $('meta[name="googlebot"]').remove()

  // Replace any existing <base> and insert our own at the top of <head>
  $('base').remove()
  const baseTag = '<base target="_blank">'
  if ($('head').length) {
    $('head').prepend(baseTag)
  } else {
    $.root().prepend(baseTag)
  }

  return $.html()
}
