/**
 * extractSite — DOM extraction via headless Chromium
 *
 * Navigates to a URL, scrolls the full page to trigger lazy-loaded content,
 * forces carousel slides and lazy images to be visible, and returns the
 * fully-rendered outerHTML.
 */
export async function extractSite(url: string): Promise<string> {
  const { chromium } = await import('playwright')

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security', // allows reading cross-origin cssRules from CSSOM
    ],
  })

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    })

    const page = await context.newPage()

    // Try networkidle first (best quality).
    // If it times out (HubSpot, Apple — too many long-running 3rd-party requests),
    // DON'T re-navigate — the page content is already rendered. Just wait for the
    // load event on the current page state and continue from there.
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
    } catch {
      await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {})
    }

    // ── Pass 1: Scroll full page to trigger lazy-load and intersection observers ──
    await page.evaluate(async () => {
      const totalHeight = document.documentElement.scrollHeight
      const step = window.innerHeight
      for (let y = 0; y < totalHeight; y += step) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 150))
      }
      window.scrollTo(0, 0)
    })

    // Wait for scroll-triggered requests to settle
    await page.waitForTimeout(2000)

    // ── Pass 2: Force lazy-loaded images to resolve ───────────────────────────
    // Many sites use data-src / data-lazy / data-srcset for lazy loading.
    // Copy these to real src/srcset so images appear in the static clone.
    await page.evaluate(() => {
      document.querySelectorAll('img').forEach((img) => {
        const lazy = img.getAttribute('data-src')
          || img.getAttribute('data-lazy')
          || img.getAttribute('data-lazy-src')
          || img.getAttribute('data-original')
          || img.getAttribute('data-url')
        if (lazy && !img.src) img.src = lazy

        const lazySrcset = img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset')
        if (lazySrcset && !img.srcset) img.srcset = lazySrcset

        // Force all lazy images to load eagerly so Playwright captures them
        if ((img as HTMLImageElement).loading === 'lazy') {
          (img as HTMLImageElement).loading = 'eager'
        }
      })

      // Also handle background-image lazy loading (data-bg, data-background)
      document.querySelectorAll('[data-bg], [data-background], [data-background-image]').forEach((el) => {
        const bg = el.getAttribute('data-bg')
          || el.getAttribute('data-background')
          || el.getAttribute('data-background-image')
        if (bg) (el as HTMLElement).style.backgroundImage = `url("${bg}")`
      })

      // Shopify-specific: srcset in data-srcset on picture source elements
      document.querySelectorAll('source[data-srcset]').forEach((source) => {
        const srcset = source.getAttribute('data-srcset')
        if (srcset) source.setAttribute('srcset', srcset)
      })
    })

    // ── Pass 3: Expand all carousel/slider slides so content is visible ───────
    // Shopify Splide/Swiper/Dawn carousels hide non-active slides via:
    //   - aria-hidden="true"
    //   - display:none / visibility:hidden inline styles
    //   - transform: translateX / opacity:0
    // We override all of these so every slide's content is captured.
    await page.evaluate(() => {
      // Common carousel item selectors
      const slideSelectors = [
        '.splide__slide',
        '.swiper-slide',
        '.slick-slide',
        '.carousel__slide',
        '[class*="slide-item"]',
        '[class*="slider__slide"]',
        '[class*="slideshow__slide"]',
        // Shopify Dawn/Debut/Sense theme slide wrappers
        '.slider__slide',
        '.slideshow__slide',
        '.product-slider__item',
        // Generic hidden slide patterns
        '[data-slide]',
        '[data-index]',
      ]

      slideSelectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          const htmlEl = el as HTMLElement
          // Remove aria-hidden so screen-reader-hidden slides become part of DOM
          htmlEl.removeAttribute('aria-hidden')
          htmlEl.removeAttribute('hidden')
          // Remove transform/opacity/visibility that hide inactive slides
          htmlEl.style.removeProperty('display')
          htmlEl.style.removeProperty('visibility')
          htmlEl.style.removeProperty('opacity')
          htmlEl.style.removeProperty('transform')
          htmlEl.style.removeProperty('position')
          htmlEl.style.removeProperty('left')
          htmlEl.style.removeProperty('right')
          htmlEl.style.removeProperty('pointer-events')
        })
      })

      // Force Shopify Splide slides: remove is-hidden class and aria states
      document.querySelectorAll('.splide__slide.is-hidden, .splide__slide[aria-hidden]').forEach((el) => {
        el.classList.remove('is-hidden')
        el.removeAttribute('aria-hidden')
      })

      // Force all slide lists to not clip overflow (prevents cropping in screenshot)
      document.querySelectorAll('.splide__list, .swiper-wrapper, .slick-track, [class*="slides-wrapper"]').forEach((el) => {
        const htmlEl = el as HTMLElement
        htmlEl.style.removeProperty('transform')
        htmlEl.style.flexWrap = 'wrap'
        htmlEl.style.removeProperty('width')
      })
    })

    // ── Pass 4: Force AOS / GSAP / Intersection Observer animated elements visible ──
    const isProductPage = url.includes('/products/')
    await page.addStyleTag({
      content: `
        /* Reveal AOS animated elements */
        *[data-aos], .aos-init:not(.aos-animate) {
          opacity: 1 !important;
          transform: none !important;
          transition: none !important;
        }
        /* Reveal Shopify Dawn/Refresh scroll-trigger sections (opacity:0.01 initial state) */
        .scroll-trigger.animate--slide-in,
        .scroll-trigger.animate--fade-in {
          opacity: 1 !important;
          transform: none !important;
          animation: none !important;
          transition: none !important;
        }
        /* Reveal GSAP / custom hidden elements */
        .gsap-hidden, .is-hidden, .js-hidden, [data-hidden="true"] {
          opacity: 1 !important;
          visibility: visible !important;
          display: block !important;
        }
        /* Reveal inline-style hidden elements (opacity:0, visibility:hidden) */
        *[style*="opacity: 0"]:not(script):not(style),
        *[style*="opacity:0"]:not(script):not(style) {
          opacity: 1 !important;
        }
        *[style*="visibility: hidden"] { visibility: visible !important; }
        /* Force all carousel slides visible — Splide, Swiper, Slick */
        .splide__slide, .swiper-slide, .slick-slide {
          opacity: 1 !important;
          visibility: visible !important;
          pointer-events: auto !important;
        }
        /* Unwrap Splide overflow clip so all slides render */
        .splide__track { overflow: visible !important; }
        .swiper-container, .swiper { overflow: visible !important; }
        .slick-list { overflow: visible !important; }
        ${isProductPage ? `
        /* ── Shopify deferred-media: show product images without JS interaction ──
           Shopify Dawn/Refresh use <deferred-media> custom element + CSS rule
           .product__media-list .deferred-media{display:none} to hide the
           product image gallery until the user clicks a play/load button.
           Without JS activation the entire product image section is invisible. */
        deferred-media,
        .deferred-media,
        .product__media-list .deferred-media,
        .product__media-container deferred-media {
          display: block !important;
          opacity: 1 !important;
          visibility: visible !important;
        }
        .product__media-item,
        .product__media-wrapper,
        .product__media {
          display: block !important;
          opacity: 1 !important;
          visibility: visible !important;
        }
        /* ── Shopify product page: force all product sections visible ──
           Many Shopify themes hide sections via CSS class-based opacity/
           visibility/display animations (not inline styles). Target every
           common theme variant for product info, brand sections, and
           supplementary product page sections. */
        .product__info-wrapper,
        .product__info-container,
        .product__info,
        .product__meta,
        .product-single__meta,
        .product-single__title,
        .product__title,
        .product__price,
        .product__description,
        .product-form,
        .product-form__wrapper,
        .product-form__buttons,
        .product__accordion,
        .product__tabs,
        .product-tabs,
        [class*="product__info"],
        [class*="product-info"],
        [class*="product__meta"],
        [class*="product-detail"],
        [class*="product-form"],
        [class*="product__desc"],
        [class*="ProductDetails"],
        [class*="product-details"],
        [class*="ProductInfo"],
        [data-product-information],
        [data-product-form],
        .product.grid,
        .product__container,
        [class*="product-template"],
        [class*="ProductTemplate"] {
          visibility: visible !important;
          opacity: 1 !important;
          max-height: none !important;
          overflow: visible !important;
          clip: auto !important;
          clip-path: none !important;
          pointer-events: auto !important;
        }
        ` : ''}
      `
    })

    // ── Pass 4b: Product page — JS force-show product info containers ────────
    // CSS overrides can't fix elements hidden via computed class styles when the
    // specificity of the theme's CSS is higher. A JS removeProperty pass wins
    // regardless of specificity by clearing the inline style cache.
    if (isProductPage) {
      await page.evaluate(() => {
        const productSelectors = [
          '.product__info-wrapper',
          '.product__info-container',
          '.product__info',
          '.product__meta',
          '.product-single__meta',
          '.product__title',
          '.product-single__title',
          '.product__price',
          '.product__description',
          '.product-form',
          '.product-form__wrapper',
          '.product__accordion',
          '[data-product-information]',
          '[data-product-form]',
        ]
        productSelectors.forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => {
            const h = el as HTMLElement
            // Do NOT removeProperty('display') — Shopify uses display:none for
            // tab panels, hidden variants, and theme-toggle divs. Flipping those
            // causes white-background skeleton loaders to appear over dark themes.
            h.style.removeProperty('visibility')
            h.style.removeProperty('opacity')
            h.style.removeProperty('height')
            h.style.removeProperty('max-height')
            h.style.removeProperty('overflow')
            h.style.removeProperty('clip')
            h.style.removeProperty('clip-path')
            h.style.removeProperty('transform')
            h.style.removeProperty('pointer-events')
          })
        })

        // Walk ALL elements and force-show any that are computed opacity:0 or
        // visibility:hidden. Do NOT flip display:none broadly — that breaks
        // tab panels, light/dark theme variants, skeleton loaders, and
        // Shopify theme toggle divs (causes white bg on dark-theme stores).
        // display:none is only flipped for the specific product selectors above.
        const skipRe = /cart[-_]?(?:drawer|notification|items|footer|form)|modal|popup|overlay|sidebar|predictive[-_]?search|search[-_]?modal|quick[-_]?(?:add|view|order)|age[-_]?(?:ver|gate)|cookie|consent|gdpr|intercom|drift|crisp|hubspot/i
        document.querySelectorAll('body *').forEach((el) => {
          const id = el.id ?? ''
          const cls = typeof el.className === 'string' ? el.className : ''
          if (skipRe.test(id + ' ' + cls)) return
          const closestSkip = el.closest('[id*="cart-drawer"],[id*="cart-notification"],[class*="cart-drawer"],[id*="modal"],[id*="popup"],[id*="predictive-search"]')
          if (closestSkip) return

          const h = el as HTMLElement
          const cs = window.getComputedStyle(h)
          if (parseFloat(cs.opacity) < 0.1) h.style.opacity = '1'
          if (cs.visibility === 'hidden') h.style.visibility = 'visible'
          // Resolve CSS variable background colors — Shopify stores set
          // --var-pdp-main-color and similar custom props via JS from metafields.
          // After JS runs, getComputedStyle gives the actual resolved color.
          // Inline it so the static clone doesn't lose it when JS is stripped.
          const inlineBg = h.style.backgroundColor
          if (inlineBg && inlineBg.startsWith('var(')) {
            h.style.backgroundColor = cs.backgroundColor
          }
          const inlineColor = h.style.color
          if (inlineColor && inlineColor.startsWith('var(')) {
            h.style.color = cs.color
          }
        })
      })

      // Force lazy images to load eagerly so Playwright captures them
      await page.evaluate(() => {
        document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
          (img as HTMLImageElement).loading = 'eager'
        })
        // Activate deferred-media elements — Shopify Dawn needs a load event
        // on the <deferred-media> custom element to show product images.
        // Directly swap the template content into the DOM as a fallback.
        document.querySelectorAll('deferred-media, .deferred-media').forEach((el) => {
          const template = el.querySelector('template')
          if (template) {
            el.appendChild(template.content.cloneNode(true))
          }
          // Remove any poster/placeholder overlays that cover the media
          el.querySelectorAll('.deferred-media__poster, [class*="poster"]').forEach(p => {
            (p as HTMLElement).style.display = 'none'
          })
        })
      })

      // Wait for product title to appear as a proxy for content being rendered
      await page.waitForSelector(
        '.product__title, .product-single__title, [class*="product__title"], h1',
        { state: 'visible', timeout: 8000 }
      ).catch(() => {})

      await page.waitForTimeout(1000)
    }

    // ── Pass 5: Second scroll pass — pick up anything that loaded late ─────────
    await page.evaluate(async () => {
      const totalHeight = document.documentElement.scrollHeight
      const step = Math.floor(window.innerHeight / 2)
      for (let y = 0; y < totalHeight; y += step) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 100))
      }
      window.scrollTo(0, 0)
    })

    await page.waitForTimeout(1500)

    // ── Dismiss cookie banners before capturing ───────────────────────────────
    await page.evaluate(() => {
      const acceptSelectors = [
        'button[id*="accept"]', 'button[class*="accept"]',
        'button[id*="Accept"]', 'button[class*="Accept"]',
        'a[id*="accept"]', 'a[class*="accept"]',
        '[data-testid*="accept"]', '[aria-label*="accept" i]',
      ]
      for (const sel of acceptSelectors) {
        const btn = document.querySelector(sel) as HTMLElement | null
        if (btn) { btn.click(); break }
      }
    })

    await page.evaluate(() => {
      const selectors = [
        '[id*="cookie"]', '[class*="cookie"]',
        '[id*="consent"]', '[class*="consent"]',
        '[id*="gdpr"]', '[class*="gdpr"]',
        '[id*="privacy-banner"]', '[class*="privacy-banner"]',
        '[id*="cc-"]', '[class*="cc-banner"]',
        '[id*="CookieBanner"]', '[class*="CookieBanner"]',
        '[id*="cookiebanner"]', '[class*="cookiebanner"]',
        '[id*="shopify-pc"]', '[class*="shopify-pc"]',
        '[id*="shopify-privacy"]', '[class*="shopify-privacy"]',
        '[id*="privacy-bar"]', '[class*="privacy-bar"]',
        '[id*="country"]', '[class*="country-selector"]', '[class*="locale-selector"]',
        '[id*="locale"]', '[class*="region-selector"]', '[id*="region-selector"]',
        '[class*="geo-"]', '[id*="geo-banner"]', '[class*="country-banner"]',
      ]
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove())
      })
      ;[
        '[id*="intercom"]', '[class*="intercom"]',
        '[id*="drift"]', '[class*="drift"]',
        '[id*="crisp"]', '[id*="hubspot"]',
        'iframe[src*="intercom"]', 'iframe[src*="drift"]',
        '[id="modal-backdrop"]', '[id="overlay-backdrop"]',
      ].forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove())
      })

      const consentBodyClasses = ['consent-required', 'no-consent', 'gdpr-required', 'cookie-required', 'privacy-required']
      consentBodyClasses.forEach(cls => document.body.classList.remove(cls))

      document.body.style.removeProperty('display')
      document.body.style.removeProperty('visibility')
      document.documentElement.style.removeProperty('overflow')
    })

    await page.waitForTimeout(300)

    // ── Extract and inline CSS from CSSOM ─────────────────────────────────────
    await page.evaluate(() => {
      const rules: string[] = []
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            rules.push(rule.cssText)
          }
        } catch {
          // Cross-origin sheet — skip, leave link tag
        }
      }
      if (rules.length > 0) {
        document.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove())
        const style = document.createElement('style')
        style.textContent = rules.join('\n')
        document.head.insertBefore(style, document.head.firstChild)
      }
    })

    return await page.evaluate(() => document.documentElement.outerHTML)
  } finally {
    await browser.close()
  }
}
