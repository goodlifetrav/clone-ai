import { load } from 'cheerio'

// Scripts that control visual layout are kept; everything else is removed.
const KEEP_SCRIPT_RE = /carousel|slider|swiper|splide|glide|tabs|accordion|toggle|modal|lightbox|fancybox/i

// Scripts with these patterns in src are always removed (even if they look visual).
const TRACKING_SRC_RE = /track|analytics|pixel|gtm[\./]|\/gtag|ga\.(js|min)|fbq|hotjar|mixpanel|segment|amplitude|klaviyo|intercom|crisp|drift/i

// ── Placeholder blocks for AJAX-loaded Shopify sections ───────────────────────
// Product recommendations and review apps require authenticated Shopify API
// calls that static cloning cannot replicate. Instead of a black void, inject
// a labeled skeleton so users understand what the section is, and so Gemini
// knows to generate that section type during brand rebuild.

const PRODUCT_CAROUSEL_PLACEHOLDER = `<div data-igualai-section="product-grid" style="padding:60px 24px;background:#111111;text-align:center;"><div style="border:2px dashed #2d2d2d;border-radius:16px;padding:40px 24px;max-width:1000px;margin:0 auto;"><p style="color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 6px;font-family:sans-serif;">&#x1F6D2; Related Products Carousel</p><p style="color:#555555;font-size:12px;margin:0 0 28px;font-family:sans-serif;line-height:1.5;">Loads from Shopify product recommendations API &mdash; requires live store data.<br>The Brand Rebuild will generate this with your products.</p><div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;"><div style="width:160px;flex-shrink:0;"><div style="height:160px;background:#1c1c1c;border-radius:8px;border:1px solid #2a2a2a;margin-bottom:10px;"></div><div style="height:9px;background:#1c1c1c;border-radius:4px;margin-bottom:6px;"></div><div style="height:9px;background:#1c1c1c;border-radius:4px;width:70%;margin:0 auto 8px;"></div><div style="height:24px;background:#1c1c1c;border-radius:6px;"></div></div><div style="width:160px;flex-shrink:0;"><div style="height:160px;background:#1c1c1c;border-radius:8px;border:1px solid #2a2a2a;margin-bottom:10px;"></div><div style="height:9px;background:#1c1c1c;border-radius:4px;margin-bottom:6px;"></div><div style="height:9px;background:#1c1c1c;border-radius:4px;width:70%;margin:0 auto 8px;"></div><div style="height:24px;background:#1c1c1c;border-radius:6px;"></div></div><div style="width:160px;flex-shrink:0;"><div style="height:160px;background:#1c1c1c;border-radius:8px;border:1px solid #2a2a2a;margin-bottom:10px;"></div><div style="height:9px;background:#1c1c1c;border-radius:4px;margin-bottom:6px;"></div><div style="height:9px;background:#1c1c1c;border-radius:4px;width:70%;margin:0 auto 8px;"></div><div style="height:24px;background:#1c1c1c;border-radius:6px;"></div></div><div style="width:160px;flex-shrink:0;"><div style="height:160px;background:#1c1c1c;border-radius:8px;border:1px solid #2a2a2a;margin-bottom:10px;"></div><div style="height:9px;background:#1c1c1c;border-radius:4px;margin-bottom:6px;"></div><div style="height:9px;background:#1c1c1c;border-radius:4px;width:70%;margin:0 auto 8px;"></div><div style="height:24px;background:#1c1c1c;border-radius:6px;"></div></div></div></div></div>`

const REVIEWS_PLACEHOLDER = `<div data-igualai-section="testimonials" style="padding:60px 24px;background:#0f0f0f;text-align:center;"><div style="border:2px dashed #2d2d2d;border-radius:16px;padding:40px 24px;max-width:1000px;margin:0 auto;"><p style="color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 6px;font-family:sans-serif;">&#x2B50; Customer Reviews</p><p style="color:#555555;font-size:12px;margin:0;font-family:sans-serif;line-height:1.5;">Loads from a third-party review app &mdash; requires live store data.<br>The Brand Rebuild will generate this section with customer testimonials.</p></div></div>`

const GENERIC_EMPTY_PLACEHOLDER = `<div data-igualai-section="content" style="padding:48px 24px;background:#111111;text-align:center;"><div style="border:2px dashed #2d2d2d;border-radius:16px;padding:32px 24px;max-width:1000px;margin:0 auto;"><p style="color:#555555;font-size:12px;margin:0;font-family:sans-serif;line-height:1.5;">This section loads dynamically &mdash; content not available in static clone.<br>The Brand Rebuild will generate this section with your brand content.</p></div></div>`

// Sections that should never be replaced with placeholders even if empty
const SKIP_SECTION_RE = /cart|drawer|search|modal|popup|overlay|sticky|announcement|header|footer|nav|cookie|gdpr|age-ver|intercom|drift|crisp|predictive/i

/**
 * Replace empty Shopify sections on product pages with labeled placeholder
 * blocks instead of leaving black voids.
 *
 * Strategy (two passes):
 * 1. Named detection — product-recommendations and known review app patterns
 *    get specific typed placeholders (carousel vs reviews)
 * 2. Broad scan — any remaining shopify-section div with < 150 chars of visible
 *    text AND no real images gets a generic "loads dynamically" placeholder
 *    This catches custom theme sections regardless of their class/id naming.
 */
function injectAjaxPlaceholders(html: string, url: string): string {
  if (!url.includes('/products/')) return html

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const $ = load(html, { xmlMode: false } as any)

  const isEffectivelyEmpty = (el: ReturnType<typeof $>[0]) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    const realImages = $(el).find('img').filter((_, img) => {
      const src = $(img).attr('src') ?? ''
      return src.length > 0 && !src.startsWith('data:')
    }).length
    return text.length < 150 && realImages === 0
  }

  const replaced = new Set<ReturnType<typeof $>[0]>()

  // ── Pass 1: Named detection for product recommendations ─────────────────────
  // Always replace regardless of content — even when the static capture picked up
  // product data, the carousel JS is missing so it renders as broken raw text.
  $('product-recommendations, [data-url*="recommendations/products"], [data-section-type="product-recommendations"], [id*="product-recommendations"], [id*="ProductRecommendations"]').each((_, el) => {
    const wrapper = $(el).closest('[id*="shopify-section"]')
    const target = wrapper.length ? wrapper[0] : el
    if (!replaced.has(target)) {
      replaced.add(target)
      $(target).replaceWith(PRODUCT_CAROUSEL_PLACEHOLDER)
    }
  })

  // ── Pass 1b: Review sections — always remove entirely ────────────────────────
  // Third-party review apps (BazaarVoice, Yotpo, Loox, etc.) render a full DOM
  // when JS runs but the layout and data are inseparable from their scripts.
  // Without the scripts the section is a wall of broken text/markup. Remove it.
  const reviewSelectors = [
    // BazaarVoice
    '[data-bv-show]', '[class*="BVRRContainer"]', '[class*="bv_main_container"]',
    '[id*="BVRRContainer"]', '[id*="bazaarvoice"]',
    // Yotpo
    'yotpo-widget', '[class*="yotpo-main-widget"]', '[id*="yotpo-reviews"]',
    '[class*="yotpo-reviews"]', '[class*="yotpo-widget"]',
    // Others
    '[class*="loox"]', '[id*="loox"]',
    '[class*="okendo"]', '[id*="okendo"]',
    '[class*="stamped"]', '[id*="stamped"]',
    '[id*="judgeme"]', '[class*="jdgm"]',
    '[data-section-type*="review"]', '[data-section-type="product-reviews"]',
    '[id*="shopify-section"][id*="review"]', '[id*="shopify-section"][id*="Reviews"]',
  ]
  reviewSelectors.forEach(sel => {
    $(sel).each((_, el) => {
      const wrapper = $(el).closest('[id*="shopify-section"]')
      const target = wrapper.length ? wrapper[0] : el
      if (!replaced.has(target)) {
        replaced.add(target)
        $(target).remove()
      }
    })
  })

  // ── Pass 2: Broad scan — any remaining empty shopify-section ───────────────
  // Custom themes use arbitrary section IDs. Match on shopify-section id/class
  // AND on data-section-id / data-section-type which many themes use instead.
  const broadSelector = '[id*="shopify-section"], [class*="shopify-section"], [data-section-id], [data-section-type]'
  const broadMatches = $(broadSelector).toArray()
  console.log(`[placeholder-scan] product page — found ${broadMatches.length} section candidates`)

  broadMatches.forEach((el) => {
    if (replaced.has(el)) return
    const id = $(el).attr('id') ?? ''
    const cls = $(el).attr('class') ?? ''
    if (SKIP_SECTION_RE.test(id + ' ' + cls)) return
    if ($(el).find('[data-igualai-section]').length > 0) return
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    const realImages = $(el).find('img').filter((_, img) => {
      const src = $(img).attr('src') ?? ''
      return src.length > 0 && !src.startsWith('data:')
    }).length
    console.log(`[placeholder-scan] id="${id}" cls="${cls.slice(0, 60)}" text=${text.length} imgs=${realImages}`)
    if (isEffectivelyEmpty(el)) {
      replaced.add(el)
      console.log(`[placeholder-scan] → replacing with generic placeholder`)
      $(el).replaceWith(GENERIC_EMPTY_PLACEHOLDER)
    }
  })

  return $.html()
}

/**
 * cleanHtml — strip noise from a cloned page:
 *  - Analytics / tracking scripts
 *  - Non-essential scripts (keep visual-layout scripts: carousels, tabs, etc.)
 *  - Canonical <link> and robots/googlebot <meta> tags
 *  - Adds <base target="_blank"> so remaining links open in new tabs
 *  - Injects labeled placeholders for AJAX-loaded sections (product pages)
 */
export function cleanHtml(html: string, url = ''): string {
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

  let result = $.html()

  // Inject labeled placeholders for empty AJAX-loaded sections (product pages only)
  if (url) result = injectAjaxPlaceholders(result, url)

  return result
}
