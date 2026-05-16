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

  // Remove cookie consent banners / GDPR popups
  $('[id*="cookie"], [class*="cookie"], [id*="consent"], [class*="consent"], [id*="gdpr"], [class*="gdpr"], [id*="privacy-banner"], [class*="privacy-banner"], [id*="cc-"], [class*="cc-banner"], [id*="CookieBanner"], [class*="CookieBanner"], [id*="cookiebanner"], [class*="cookiebanner"], [id*="shopify-pc"], [class*="shopify-pc"], [id*="shopify-privacy"], [class*="shopify-privacy"], [id*="privacy-bar"], [class*="privacy-bar"]').remove()

  // Remove country/region selector overlays (Apple-style geo-redirect banners)
  $('[id*="country"], [class*="country-selector"], [class*="locale-selector"], [id*="locale"], [class*="region-selector"], [id*="region-selector"], [class*="geo-"], [id*="geo-banner"], [class*="country-banner"]').remove()

  // Remove modal backdrops left behind by cookie banners or popups.
  // Only target elements whose id/class explicitly signals a modal/popup backdrop —
  // NOT generic "overlay" which Framer and other frameworks use for real layout containers.
  $('[id="modal-backdrop"], [id="overlay-backdrop"], [class="modal-backdrop"], [id="modal-bg"], [class*="modal-bg"]').remove()

  // Remove Shopify-specific hidden/utility sections that are in the DOM but not visible page content:
  // cart drawers, cart notifications, predictive search, age verification, quick-view modals, etc.
  // These sections are always present in Shopify themes but hidden until triggered by JS.
  const shopifyHiddenSections = [
    'cart-drawer', 'cart-notification', 'cart-items', 'cart-footer',
    'predictive-search', 'search-modal',
    'quick-add', 'quick-view', 'quick-order',
    'age-verification', 'age-verify', 'age-gate',
    'announcement-popup', 'email-popup', 'exit-popup',
    'mobile-menu', 'mobile-nav',
  ]
  shopifyHiddenSections.forEach(keyword => {
    $(`[id*="${keyword}"], [class*="${keyword}"]`).each((_, el) => {
      // Only remove if the element is Shopify-section-level (direct child of body or a shopify-section wrapper)
      // to avoid accidentally removing real page content that happens to share a class name
      const id = $(el).attr('id') ?? ''
      const cls = $(el).attr('class') ?? ''
      if (id.includes('shopify-section') || id.includes(keyword) || cls.includes('shopify-section')) {
        $(el).remove()
      }
    })
  })

  // Remove live chat widgets (Intercom, Drift, Crisp, HubSpot, Zendesk)
  $('[id*="intercom"], [class*="intercom"], [id*="drift"], [class*="drift"], [id*="crisp"], [id*="hubspot"], [class*="hubspot"], [id*="launcher"], iframe[src*="intercom"], iframe[src*="drift"], iframe[src*="crisp"]').remove()

  // Remove consent-blocking body classes that hide page content
  const bodyEl = $('body')
  const consentClasses = ['consent-required', 'no-consent', 'gdpr-required', 'cookie-required', 'privacy-required']
  consentClasses.forEach(cls => bodyEl.removeClass(cls))

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
