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
  // Catches: Shopify native product-recommendations, common third-party
  // "Also Bought" apps, upsell/cross-sell widgets, Rebuy product grids, etc.
  // NOTE: [class*="rebuy-widget"] and [id*="rebuy"] are intentionally NOT used
  // here — they match Rebuy's cart flyout, notification modals, and checkout
  // widgets which are utility sections (not carousels) and appear after the footer.
  $('product-recommendations, [data-url*="recommendations/products"], [data-section-type="product-recommendations"], [id*="product-recommendations"], [id*="ProductRecommendations"], [id*="also-bought"], [id*="AlsoBought"], [id*="others-also-bought"], [id*="related-products"], [id*="cross-sell"], [id*="upsell-section"], [class*="also-bought"], [data-section-type="also-bought"], [data-section-type="related-products"], .rebuy-product-grid, .rebuy-recommended-products').each((_, el) => {
    const wrapper = $(el).closest('[id*="shopify-section"]')
    const wrapperId = wrapper.attr('id') ?? ''
    const wrapperCls = wrapper.attr('class') ?? ''
    // Skip cart drawers, search modals, and other utility sections
    if (SKIP_SECTION_RE.test(wrapperId + ' ' + wrapperCls)) return
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
  //
  // IMPORTANT: Some selectors (e.g. [data-bv-show]) also match INLINE rating
  // widgets (data-bv-show="inline_rating") that live INSIDE the main product
  // template section — not just dedicated review sections. If we blindly escalate
  // to removing the shopify-section wrapper we delete the entire product info
  // block (title, images, price, add-to-cart). Only remove the wrapper when its
  // own ID/class confirms it is a dedicated review section.
  const reviewSelectors = [
    // BazaarVoice — [data-bv-show] matches both inline_rating AND full reviews
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
      const wrapperId = wrapper.attr('id') ?? ''
      const wrapperCls = wrapper.attr('class') ?? ''
      // Only escalate to removing the entire shopify-section when the section
      // itself is clearly a dedicated review/ratings section. Otherwise just
      // remove the review widget element — leaving the surrounding product
      // section (title, media, form) intact.
      const isReviewSection = wrapper.length &&
        /review|rating|testimonial|yotpo|stamped|loox|okendo|judge|jdgm/i.test(wrapperId + ' ' + wrapperCls)
      const target = isReviewSection ? wrapper[0] : el
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

  // [CLONE-DEBUG] checkpoint: record cheerio-rendered body length at each
  // major sub-step so we can pinpoint which removal call is shrinking the
  // body unexpectedly. Logs only — no behavior change.
  const ckpt = (step: string) => {
    const bodyHtml = $('body').html() ?? ''
    console.log(`[CLONE-DEBUG] ${JSON.stringify({
      stage: `cleanHtml.${step}`,
      bodyLen: bodyHtml.length,
      imgCount: $('img').length,
      sectionCount: $('section').length,
      divCount: $('div').length,
    })}`)
  }
  ckpt('start')

  // ── Bug 3: Unwrap <noscript> fallback content ───────────────────────────
  // Many sites wrap fallback <img> tags in <noscript> so they only render when
  // JavaScript is disabled. Since we strip ALL scripts to make the clone static,
  // the page is effectively script-free — but the browser still has scripting
  // *enabled*, so <noscript> content stays hidden. Unwrap it here so fallback
  // images and CSS links surface in the saved clone.
  $('noscript').each((_, el) => {
    const inner = $(el).html() ?? ''
    if (inner.trim()) {
      $(el).replaceWith(inner)
    } else {
      $(el).remove()
    }
  })

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

  ckpt('after.scripts')

  // ── Strip EasyLockdown and similar app content-gate inline styles ────────────
  // These apps set style="display:none" on a wrapper div that contains the full
  // page content, then remove it via JS after an auth check. Our cloner captures
  // the page unauthenticated so the wrapper stays hidden. Clear the display
  // property to expose the real content in all saved clones.
  $('.easylockdown-content, [class*="easylockdown"], [id*="easylockdown"]').each((_, el) => {
    const existingStyle = $(el).attr('style') ?? ''
    const cleaned = existingStyle.replace(/\bdisplay\s*:\s*none\s*;?\s*/gi, '').trim()
    if (cleaned) {
      $(el).attr('style', cleaned)
    } else {
      $(el).removeAttr('style')
    }
  })

  // Remove modal backdrops left behind by cookie banners or popups.
  // Only target elements whose id/class explicitly signals a modal/popup backdrop —
  // NOT generic "overlay" which Framer and other frameworks use for real layout containers.
  $('[id="modal-backdrop"], [id="overlay-backdrop"], [class="modal-backdrop"], [id="modal-bg"], [class*="modal-bg"]').remove()

  // Remove promotional/marketing popups (exit intent, discount offers, newsletter signups).
  // Target role="dialog" and common promo popup patterns — but only when they look like
  // overlays (fixed/absolute position or explicit modal/popup class), not inline content blocks.
  $('[role="dialog"][aria-modal="true"]').each((_, el) => {
    // Only remove if it looks like an overlay (has backdrop, or fixed/absolute positioning)
    const style = $(el).attr('style') ?? ''
    const cls = ($(el).attr('class') ?? '').toLowerCase()
    const id = ($(el).attr('id') ?? '').toLowerCase()
    const isOverlay = style.includes('fixed') || style.includes('absolute') ||
      cls.includes('modal') || cls.includes('popup') || cls.includes('dialog') ||
      cls.includes('overlay') || cls.includes('lightbox') ||
      id.includes('modal') || id.includes('popup') || id.includes('dialog')
    if (isOverlay) $(el).remove()
  })

  // Remove elements that are explicitly promotional popups by class/id pattern
  $([
    '[id*="promo-modal"]', '[class*="promo-modal"]',
    '[id*="popup-modal"]', '[class*="popup-modal"]',
    '[id*="email-modal"]', '[class*="email-modal"]',
    '[id*="newsletter-modal"]', '[class*="newsletter-modal"]',
    '[id*="exit-modal"]', '[class*="exit-modal"]',
    '[id*="offer-modal"]', '[class*="offer-modal"]',
    '[id*="discount-modal"]', '[class*="discount-modal"]',
    '[id*="sale-modal"]', '[class*="sale-modal"]',
    '[id*="lightbox-modal"]', '[class*="lightbox-modal"]',
  ].join(', ')).remove()

  // Remove fixed/absolute full-screen dark overlays (modal backdrops without explicit class names).
  // Only remove when they have near-full viewport size and dark/semi-transparent background —
  // a strong signal it's a modal backdrop, not a hero section.
  $('body > div, body > section').each((_, el) => {
    const style = ($(el).attr('style') ?? '').toLowerCase()
    const cls = ($(el).attr('class') ?? '').toLowerCase()
    const hasFixed = style.includes('position:fixed') || style.includes('position: fixed')
    const hasInset = style.includes('inset:0') || style.includes('inset: 0') ||
      (style.includes('top:0') && style.includes('left:0'))
    const looksLikeBackdrop = cls.includes('backdrop') || cls.includes('overlay-bg') || cls.includes('modal-wrap')
    if (hasFixed && hasInset) $(el).remove()
    else if (looksLikeBackdrop) $(el).remove()
  })

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

  ckpt('after.modalsAndPopups')

  // ── Bug 5: referrerpolicy="no-referrer" on every <img> ────────────────────
  // R2-hosted images don't need a referrer, and any image whose R2 upload failed
  // and still points at the origin host will likely 403 if the referrer reveals
  // an unexpected origin (Hostinger, localhost). no-referrer is the safest default
  // for a static clone — strips Referer entirely so origin hotlink protection
  // can't block the fallback fetch.
  $('img').each((_, el) => {
    if (!$(el).attr('referrerpolicy')) {
      $(el).attr('referrerpolicy', 'no-referrer')
    }
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

  // ── Fix vertical writing-mode in inlined CSS ─────────────────────────────────
  // Direct string replace across ALL <style> blocks — no regex rule-block parsing
  // needed. The extractor already fixes this in-browser via computed styles, but
  // this pass covers anything in CSS fetched by css-inliner.ts after extraction.
  $('style').each((_, styleEl) => {
    let css = $(styleEl).html() ?? ''
    if (!css.includes('writing-mode')) return
    css = css
      .replace(/writing-mode\s*:\s*vertical-rl/gi, 'writing-mode:horizontal-tb')
      .replace(/writing-mode\s*:\s*vertical-lr/gi, 'writing-mode:horizontal-tb')
      .replace(/writing-mode\s*:\s*sideways-rl/gi, 'writing-mode:horizontal-tb')
      .replace(/writing-mode\s*:\s*sideways-lr/gi, 'writing-mode:horizontal-tb')
    $(styleEl).html(css)
  })

  ckpt('before.carouselNormalize')

  // ── Normalize carousel containers to CSS grid ─────────────────────────────
  // Strategy: replace the full carousel with a clean flex-wrap product grid.
  //
  //   1. Remove clone slides (Splide creates duplicates for infinite-loop;
  //      they appear as blank rows or duplicate product cards in the grid).
  //   2. Repair inline styles on slide children that cause vertical text:
  //      - writing-mode:vertical-* → horizontal-tb
  //      - width < 30px on any element inside a slide → auto (these are the
  //        narrow product-name strips some themes use as a design element;
  //        without carousel JS they make text render one char per line).
  //   3. Reset track overflow and list transform so all slides are reachable.
  //   4. Apply flex-wrap grid layout to slides.

  // Step 1: Remove clone / duplicate slides before any layout changes
  $('.splide__slide--clone, [class*="splide__slide"][class*="clone"]').remove()
  $('.swiper-slide-duplicate, .swiper-slide[data-swiper-slide-index]').each((_, el) => {
    // Only remove true duplicates (Swiper sets data-swiper-slide-index on clones)
    const idx = $(el).attr('data-swiper-slide-index')
    if (idx !== undefined) $(el).remove()
  })
  $('.slick-cloned').remove()

  // Step 2: Force horizontal text on every text-bearing element inside carousel slides.
  //
  // Why inline !important instead of a <style> rule:
  //   - Shopify themes often use a selector like `.splide__slide .product-name`
  //     (specificity 0,2,0) with `!important`.
  //   - Our <style> override `.splide__slide *` only has specificity 0,1,0 — it
  //     loses to the theme when both use !important.
  //   - Inline `style="writing-mode:horizontal-tb!important"` has the ABSOLUTE
  //     highest cascade priority (inline + !important) and beats everything.
  //
  // We also strip any CSS-class-sourced narrow width (< 30px) that makes text
  // render one character per line, adding a width:auto!important override.
  const SLIDE_SEL = '.splide__slide, .swiper-slide, .slick-slide'
  $(SLIDE_SEL).each((_, slide) => {
    // All existing inline styles: fix writing-mode and narrow width
    $(slide).find('[style]').each((_, el) => {
      let s = $(el).attr('style') ?? ''
      s = s.replace(/writing-mode\s*:[^;]+;?\s*/gi, '')
           .replace(/text-orientation\s*:[^;]+;?\s*/gi, '')
      const wMatch = s.match(/(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)(px)/)
      if (wMatch && parseFloat(wMatch[1]) < 30) {
        s = s.replace(/(?:^|;)\s*width\s*:\s*\d+(?:\.\d+)?px\s*/gi, ';width:auto!important;min-width:60px!important;')
      }
      $(el).attr('style', s.replace(/^;+/, '').replace(/;{2,}/g, ';').trim())
    })
    // Text elements: inject writing-mode:horizontal-tb!important unconditionally
    // so it wins regardless of what the inlined stylesheet declares.
    $(slide).find('p, h1, h2, h3, h4, h5, h6, span, a, strong, em, li').each((_, el) => {
      const existing = ($(el).attr('style') ?? '')
        .replace(/writing-mode\s*:[^;]+;?\s*/gi, '')
        .replace(/text-orientation\s*:[^;]+;?\s*/gi, '')
        .replace(/;{2,}/g, ';')
        .replace(/^;|;$/g, '')
      $(el).attr('style', existing
        ? `${existing};writing-mode:horizontal-tb!important`
        : 'writing-mode:horizontal-tb!important'
      )
    })
    // Product-name containers: also force auto width via inline !important
    $(slide).find('[class*="title"],[class*="name"],[class*="heading"],[class*="label"],[class*="product__"],[class*="card__"]').each((_, el) => {
      let s = $(el).attr('style') ?? ''
      if (!/\bwidth\s*:\s*(auto|[0-9])/i.test(s)) {
        s = (s ? s + ';' : '') + 'width:auto!important;min-width:0!important'
        $(el).attr('style', s)
      }
    })
  })

  // Returns true when el (or its ancestor) is a fullscreen hero slider, not a product carousel.
  // Fullscreen heroes need the first slide shown at 100% width, not a flex-wrap thumbnail grid.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isFullscreenHero(el: any): boolean {
    return $(el).is('[class*="fullscreen"],[class*="-hero"],[class*="hero-"],[class*="-banner"],[class*="banner-"],[class*="page-header"],[class*="n-slideshow"]') ||
      $(el).closest('[class*="fullscreen"],[class*="n-slideshow"],[class*="-hero"],[class*="hero-"],[class*="-banner"],[class*="banner-"],[class*="page-header"]').length > 0
  }

  // Returns true when the carousel is a testimonial/quote/review/story carousel
  // with long text per slide. The default flex-wrap grid (180-320px per slide)
  // crushes long-quote text into one-word-per-line. These need full-width slides
  // in a vertical stack so each quote is readable.
  // Detection:
  //   - container/ancestor class signals: testimonial, quote, review, customer, feedback, story
  //   - OR average text length per slide > 150 chars (catches custom-named carousels)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isWideContentCarousel(el: any): boolean {
    const classHit = $(el).is('[class*="testimonial"],[class*="quote"],[class*="review"],[class*="customer"],[class*="feedback"],[class*="story"]') ||
      $(el).closest('[class*="testimonial"],[class*="quote"],[class*="review"],[class*="customer"],[class*="feedback"],[class*="story"]').length > 0
    if (classHit) return true
    const slides = $(el).children()
    if (slides.length === 0) return false
    let totalText = 0
    slides.each((_, s) => {
      totalText += $(s).text().replace(/\s+/g, ' ').trim().length
    })
    return totalText / slides.length > 150
  }

  // Step 3: Track — keep overflow hidden, clear JS-set height so rows can wrap.
  // Skip fullscreen hero containers — their CSS sets the correct height; overriding
  // with height:auto collapses the slide to zero.
  $('.splide__track, .swiper-container, .swiper, .slick-list').each((_, el) => {
    if (isFullscreenHero(el)) return
    const s = ($(el).attr('style') ?? '')
      .replace(/overflow\s*:[^;]+;?\s*/gi, '')
      .replace(/height\s*:[^;]+;?\s*/gi, '')
      .trim()
    $(el).attr('style', s ? `${s};overflow:hidden;height:auto` : 'overflow:hidden;height:auto')
  })

  // Step 4: List — reset transform, enable flex-wrap.
  //
  // Library-agnostic detection: the named selectors below cover Splide, Swiper,
  // and Slick. After that we ALSO scan for custom carousels (Nike's Next.js
  // implementation, hand-rolled React/Vue ones) by looking for any <ul>/<ol>/<div>
  // whose children share a "slide-like" pattern. Without this Nike's <li class="slide
  // item-N"> list never gets normalized and the products stack vertically.
  //
  // Three layouts per container:
  //   - Fullscreen heroes: first slide only, 100% width
  //   - Wide-content carousels (testimonials, quotes, reviews, long text):
  //     vertical stack, each slide at 100% width with a max-width for readability
  //   - Default (product carousels): flex-wrap grid with 180-320px slides
  // All branches cap visible slides at MAX_VISIBLE_SLIDES; the rest get
  // display:none. Matches the UX of a real carousel (which only shows a few
  // at a time) and kills excessive vertical scroll on 9+ slide rails.
  const MAX_VISIBLE_SLIDES = 6
  const namedCarousels = $('.splide__list, .swiper-wrapper, .slick-track').toArray()
  const customCarousels: typeof namedCarousels = []
  $('ul, ol, div').each((_, el) => {
    if (namedCarousels.includes(el)) return
    const $el = $(el)
    const children = $el.children()
    const n = children.length
    if (n < 3 || n > 30) return
    let slideLike = 0
    children.each((_, c) => {
      const cls = $(c).attr('class') ?? ''
      const tag = (c as { tagName?: string }).tagName ?? ''
      // Match: any token containing the word "slide", or "item-N" suffix,
      // or carousel-item / carousel_item, or data-slide / data-index attrs.
      // Also: <li>'s direct under a parent are inherently slide-like in lists.
      if (
        /\bslide\b/i.test(cls) ||
        /\bitem-\d+\b/i.test(cls) ||
        /\bcarousel[-_]item\b/i.test(cls) ||
        $(c).attr('data-slide') !== undefined ||
        $(c).attr('data-index') !== undefined ||
        $(c).attr('data-slide-index') !== undefined ||
        (tag.toLowerCase() === 'li' && /\bslide\b|\bitem\b/i.test(cls))
      ) {
        slideLike++
      }
    })
    // Need 3+ slide-like children AND they must dominate the container (>=70%).
    if (slideLike >= 3 && slideLike / n >= 0.7) {
      customCarousels.push(el)
    }
  })
  const allCarousels = [...namedCarousels, ...customCarousels]
  if (customCarousels.length > 0) {
    console.log(`[html-cleaner] Found ${customCarousels.length} custom (non-Splide/Swiper/Slick) carousels`)
  }

  allCarousels.forEach((el) => {
    if (isFullscreenHero(el)) {
      $(el).attr('style', 'display:block;transform:none;width:100%;list-style:none;padding:0;height:100%')
      $(el).children().each((i, slide) => {
        $(slide).removeAttr('aria-hidden')
        if (i === 0) {
          $(slide).attr('style', 'display:block;width:100%;height:100%')
        } else {
          $(slide).attr('style', 'display:none')
        }
      })
      return
    }
    if (isWideContentCarousel(el)) {
      $(el).attr('style', 'display:flex;flex-direction:column;gap:24px;transform:none;width:100%;list-style:none;padding:0;height:auto;align-items:center')
      $(el).children().each((i, slide) => {
        $(slide).removeAttr('aria-hidden')
        if (i < MAX_VISIBLE_SLIDES) {
          $(slide).attr('style', 'display:block;width:100%;max-width:900px;height:auto;overflow:visible')
        } else {
          $(slide).attr('style', 'display:none')
        }
      })
      return
    }
    $(el).attr('style', 'display:flex;flex-wrap:wrap;gap:12px;transform:none;width:100%;list-style:none;padding:0;height:auto')
    $(el).children().each((i, slide) => {
      $(slide).removeAttr('aria-hidden')
      if (i < MAX_VISIBLE_SLIDES) {
        $(slide).attr('style', 'flex:1 1 200px;max-width:320px;min-width:180px;display:block;overflow:hidden;height:auto')
      } else {
        $(slide).attr('style', 'display:none')
      }
    })
  })

  // Remove non-functional carousel UI (arrows, pagination dots)
  $('.splide__arrows, .splide__pagination, .swiper-button-prev, .swiper-button-next, .swiper-pagination, .slick-prev, .slick-next, .slick-dots').remove()

  // CSS safety-net: catch any writing-mode not set via inline style
  if ($('head').length) {
    $('head').append('<style>.splide__slide *,.swiper-slide *,.slick-slide *{writing-mode:horizontal-tb!important;text-orientation:mixed!important}</style>')
  }

  ckpt('after.carouselNormalize')

  // Remove sections Playwright tagged as empty AJAX shells. The marking is
  // done from inside the live browser where we know the real rendered height
  // and visible text — far safer than guessing from static HTML.
  const emptyShellCount = $('[data-igualai-empty="1"]').length
  $('[data-igualai-empty="1"]').remove()
  console.log(`[CLONE-DEBUG] ${JSON.stringify({
    stage: 'cleanHtml.after.emptyShellRemove',
    removed: emptyShellCount,
    bodyLen: ($('body').html() ?? '').length,
  })}`)

  let result = $.html()

  // Inject labeled placeholders for empty AJAX-loaded sections (product pages only)
  if (url) {
    const lenBefore = result.length
    result = injectAjaxPlaceholders(result, url)
    console.log(`[CLONE-DEBUG] ${JSON.stringify({
      stage: 'cleanHtml.after.ajaxPlaceholders',
      htmlLen: result.length,
      delta: result.length - lenBefore,
    })}`)
  }

  // Strip Unicode line/paragraph separators (U+2028 / U+2029) and other unusual
  // line terminators (U+0085 NEL, U+000B VT, U+000C FF). Monaco editor opens a
  // blocking confirm() dialog on these — which freezes the editor at 0 chars
  // until the user dismisses it. Browsers render them as whitespace anyway, so
  // replacing with a regular space is safe.
  result = result.replace(/[\u2028\u2029\u0085\u000B\u000C]/g, ' ')

  return result
}
