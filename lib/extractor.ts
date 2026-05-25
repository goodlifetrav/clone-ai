/**
 * extractSite — DOM extraction via headless Chromium
 *
 * Navigates to a URL, scrolls the full page to trigger lazy-loaded content,
 * forces carousel slides and lazy images to be visible, and returns the
 * fully-rendered outerHTML plus a URL map of original URLs → R2 CDN URLs
 * (populated when projectId is provided and R2 is configured).
 */
export type FrameworkSignal =
  | 'next'
  | 'nuxt'
  | 'angular'
  | 'vue'
  | 'react'
  | 'spa-shell'
  | null

/**
 * Thrown when the target URL serves a bot/CAPTCHA challenge page instead of
 * the real site. The clone route catches this and returns a clear error to
 * the user — saving the challenge page as a "clone" would silently corrupt
 * the project with junk content.
 */
export class BotProtectionError extends Error {
  readonly kind = 'bot-protection' as const
  constructor(public detector: string) {
    super(`Site is protected by a bot challenge (${detector}). The clone cannot complete.`)
    this.name = 'BotProtectionError'
  }
}

export async function extractSite(
  url: string,
  projectId?: string
): Promise<{
  html: string
  urlMap: Map<string, string>
  screenshotBase64: string
  contentDensity: { imgs: number; textLen: number; headings: number }
  frameworkDetected: FrameworkSignal
}> {
  // Use playwright-extra with stealth plugin to bypass Cloudflare and other
  // bot-detection systems. Falls back to plain playwright if not installed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let launchFn: (opts: any) => Promise<import('playwright').Browser>
  try {
    const playwrightExtra = await import('playwright-extra')
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default
    playwrightExtra.chromium.use(StealthPlugin())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    launchFn = (playwrightExtra.chromium as any).launch.bind(playwrightExtra.chromium)
    console.log('[extractor] Using playwright-extra with stealth plugin')
  } catch {
    const pw = await import('playwright')
    launchFn = pw.chromium.launch.bind(pw.chromium)
    console.log('[extractor] playwright-extra not available, using plain playwright')
  }

  const browser = await launchFn({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security', // allows reading cross-origin cssRules from CSSOM
      '--disable-blink-features=AutomationControlled', // hide headless automation flag
      '--disable-features=VizDisplayCompositor',
      '--window-size=1920,1080',
    ],
  })

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
    })

    const page = await context.newPage()

    // ── Anti-bot stealth: hide navigator.webdriver and other automation signals ──
    // Cloudflare, PerimeterX, Datadome detect headless Chrome via:
    //   1. navigator.webdriver = true (Chrome sets this in headless mode)
    //   2. Missing window.chrome object
    //   3. Inconsistent navigator.plugins / navigator.languages
    // addInitScript runs in every frame before any page JS, so it patches
    // these before bot-detection scripts can read them.
    await context.addInitScript(() => {
      // Hide webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      // Spoof plugins (headless has 0)
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
      // Spoof languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
      // Add window.chrome (missing in headless)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} }
      // Spoof screen dimensions (headless defaults differ)
      Object.defineProperty(screen, 'width', { get: () => 1920 })
      Object.defineProperty(screen, 'height', { get: () => 1080 })
      Object.defineProperty(screen, 'availWidth', { get: () => 1920 })
      Object.defineProperty(screen, 'availHeight', { get: () => 1040 })
      Object.defineProperty(screen, 'colorDepth', { get: () => 24 })
      // Permissions API: headless returns 'denied' for notifications; real Chrome prompts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const origQuery = (window.navigator.permissions as any)?.query?.bind(window.navigator.permissions)
      if (origQuery) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window.navigator.permissions as any).query = (params: any) =>
          params.name === 'notifications'
            ? Promise.resolve({ state: 'prompt' })
            : origQuery(params)
      }
    })

    // ── Request interception: capture all images/fonts to R2 in real-time ────────
    // This is fundamentally better than post-hoc URL scraping because it captures
    // resources loaded by JavaScript (hero backgrounds, carousel images) that
    // are never visible in the initial HTML source.
    const urlMap = new Map<string, string>()
    const uploadPromises: Promise<void>[] = []
    const MAX_INTERCEPT = 300

    if (projectId) {
      const [{ uploadToR2, isR2Configured }, { createHash }] = await Promise.all([
        import('./r2'),
        import('crypto'),
      ])

      if (isR2Configured()) {
        await page.route('**/*', async (route) => {
          const request = route.request()
          const resourceType = request.resourceType()
          const resourceUrl = request.url()

          const shouldCapture =
            (resourceType === 'image' || resourceType === 'font') &&
            !resourceUrl.startsWith('data:') &&
            !resourceUrl.includes('r2.dev') &&
            uploadPromises.length < MAX_INTERCEPT

          if (shouldCapture) {
            try {
              const response = await route.fetch({ timeout: 10000 })
              if (response.ok()) {
                const body = await response.body()
                const contentType = (response.headers()['content-type'] ?? '').split(';')[0].trim()

                const uploadPromise = (async () => {
                  try {
                    const EXT_MAP: Record<string, string> = {
                      'image/jpeg': 'jpg', 'image/jpg': 'jpg',
                      'image/png': 'png', 'image/webp': 'webp',
                      'image/gif': 'gif', 'image/avif': 'avif',
                      'image/svg+xml': 'svg', 'image/x-icon': 'ico',
                      'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf',
                      'application/font-woff2': 'woff2', 'application/x-font-woff': 'woff',
                    }
                    const ext =
                      EXT_MAP[contentType] ??
                      (resourceUrl.split('?')[0].split('.').pop()?.toLowerCase()?.slice(0, 5) ?? 'bin')
                    const folder = contentType.startsWith('font/') || contentType.includes('font') ? 'fonts' : 'images'
                    const hash = createHash('md5').update(resourceUrl).digest('hex')
                    const key = `projects/${projectId}/${folder}/${hash}.${ext}`
                    const r2Url = await uploadToR2(body, key, contentType || 'application/octet-stream')
                    urlMap.set(resourceUrl, r2Url)
                    // Also map protocol-relative form
                    if (resourceUrl.startsWith('https://')) urlMap.set('//' + resourceUrl.slice(8), r2Url)
                    else if (resourceUrl.startsWith('http://')) urlMap.set('//' + resourceUrl.slice(7), r2Url)
                  } catch {
                    // Upload failure is non-fatal — original URL stays in HTML
                  }
                })()
                uploadPromises.push(uploadPromise)
                await route.fulfill({ response })
                return
              }
            } catch {
              // Fetch failure — fall through to route.continue()
            }
          }

          await route.continue()
        })

        console.log(`[extractor] Request interception enabled for project ${projectId}`)
      }
    }

    // Handle mid-navigation: some sites redirect (www., https://, geo-redirects).
    // Wait for the final URL to settle before proceeding.
    let finalUrl = url
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) finalUrl = frame.url()
    })

    // Try networkidle first (best quality).
    // If it times out (HubSpot, Apple — too many long-running 3rd-party requests),
    // DON'T re-navigate — the page content is already rendered. Just wait for the
    // load event on the current page state and continue from there.
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
    } catch {
      await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {})
    }

    const tNav = Date.now()
    console.log(`[CLONE-DEBUG] stage=extract.goto url=${url} finalUrl=${finalUrl}`)

    // If the page redirected to a different URL, wait for it to fully settle
    if (finalUrl !== url) {
      console.log(`[extractor] Redirected: ${url} → ${finalUrl}`)
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() =>
        page.waitForLoadState('load', { timeout: 10000 }).catch(() => {})
      )

      // URL-stability gate: nike.com → /fr/ triggers a Next.js client-side
      // soft-navigation AFTER networkidle settles. The soft-nav destroys
      // page.evaluate execution contexts mid-extraction. Watch the URL for
      // 3 consecutive seconds of no change before proceeding.
      let stableUrl = page.url()
      let stableSince = Date.now()
      for (let attempt = 0; attempt < 30; attempt++) {
        await page.waitForTimeout(500)
        const now = page.url()
        if (now !== stableUrl) {
          stableUrl = now
          stableSince = Date.now()
          console.log(`[extractor] URL changed during settle: → ${now}`)
        }
        if (Date.now() - stableSince >= 3000) break
      }
    }

    // ── Pre-clean framework signal sweep ────────────────────────────────────
    // Captures the raw SPA / framework signals from the live page BEFORE any
    // DOM mutation passes. Logged via [CLONE-DEBUG] for benchmark diagnosis;
    // does NOT change any extraction behavior.
    try {
      const signals = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any
        return {
          nextData_window: !!w.__NEXT_DATA__,
          nextData_script: !!document.getElementById('__NEXT_DATA__'),
          nextRoot: !!document.getElementById('__next'),
          nuxt_window: !!w.__NUXT__,
          nuxt_root: !!document.getElementById('__nuxt') || !!document.getElementById('__nuxt__'),
          initialState: !!w.__INITIAL_STATE__,
          dataReactroot: !!document.querySelector('[data-reactroot]'),
          ngVersion: !!document.querySelector('[ng-version]'),
          dataVApp: !!document.querySelector('[data-v-app]'),
          dataServerRendered: !!document.querySelector('[data-server-rendered]'),
          vueGlobal: !!w.Vue || !!w.__VUE__,
          reactDevtools:
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            !!(w.__REACT_DEVTOOLS_GLOBAL_HOOK__ as any)?.renderers?.size,
          rootEmpty: (() => {
            const r = document.querySelector('#root, #app')
            return r ? r.children.length === 0 : false
          })(),
          title: (document.title ?? '').slice(0, 80),
          bodyTextLen: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().length,
          imgCount: document.querySelectorAll('img').length,
        }
      })
      console.log(`[CLONE-DEBUG] stage=extract.signals.pre-clean ${JSON.stringify(signals)}`)
    } catch (err) {
      console.log('[CLONE-DEBUG] stage=extract.signals.pre-clean error=', err instanceof Error ? err.message.slice(0, 120) : err)
    }

    // ── Bug 4: Bot/CAPTCHA challenge detection ──────────────────────────────
    // Cloudflare Managed Challenge, Datadome, PerimeterX, and Imperva all serve
    // a placeholder HTML shell while their JS verifies the browser. Without
    // detection we'd silently save the challenge page as the "clone" — junk.
    // Detect via the unique signatures these services leave on the page:
    //   - <title> ("Just a moment...", "Attention Required", etc.)
    //   - Cloudflare's #challenge-form / .cf-browser-verification
    //   - <iframe src="https://challenges.cloudflare.com/...">
    //   - Datadome's window.dd_cookie_test_xxxx + body class
    try {
      const botSignal = await page.evaluate(() => {
        const title = (document.title ?? '').trim()
        const challengeTitleRe = /^(just a moment|attention required|access denied|please wait|verifying|one more step|checking your browser|security check|ddos protection)/i
        if (challengeTitleRe.test(title)) return `title:${title.slice(0, 60)}`

        if (document.querySelector('#challenge-form, #challenge-running, .cf-browser-verification, .cf-challenge-running')) {
          return 'cf:challenge-form'
        }
        if (document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"]')) {
          return 'cf:turnstile-iframe'
        }
        if (document.querySelector('[id*="cf-wrapper"], [class*="cf-error"]')) {
          return 'cf:wrapper'
        }
        // Datadome — the captcha page exposes a specific script and body class
        if (document.querySelector('script[src*="datadome"], #ddv1-captcha-container, [class*="datadome"]')) {
          return 'datadome'
        }
        // PerimeterX / HUMAN
        if (document.querySelector('#px-captcha, [class*="_pxCaptcha"]')) {
          return 'perimeterx'
        }
        // Imperva
        if (document.querySelector('iframe[src*="incapsula"]')) {
          return 'imperva'
        }
        return null
      })

      if (botSignal) {
        console.log(`[CLONE] BotProtection detected: ${botSignal} — aborting extraction`)
        throw new BotProtectionError(botSignal)
      }
    } catch (err) {
      if (err instanceof BotProtectionError) throw err
      // page.evaluate failure is non-fatal — continue with extraction
    }

    // ── Pillar 1: Dismiss modals/popups BEFORE content capture ──────────────
    // Geo-redirect overlays, cookie consent banners, country selectors, age gates,
    // and newsletter popups block the entire page viewport. Dismiss them early
    // so scroll passes capture real content, not modal backdrops.
    try {
      // Step 1: Click close/accept buttons on any visible overlay
      await page.evaluate(() => {
        const closeSelectors = [
          // OneTrust / Cookiebot / TrustArc / GDPR
          '#onetrust-accept-btn-handler', '.onetrust-accept-btn-handler',
          '#accept-recommended-btn-handler', '.js-accept-all-cookies',
          '[id*="cookieConsent"] button', '[id*="CookieConsent"] button',
          '[class*="cookie-accept"]', '[class*="cookieAccept"]',
          '[id*="accept-cookies"]', '[class*="accept-cookies"]',
          // Generic ARIA close/dismiss/accept
          '[aria-label*="close" i]', '[aria-label*="dismiss" i]',
          '[aria-label*="accept cookie" i]', '[aria-label*="accept all" i]',
          // Modal/dialog close buttons
          '[data-dismiss="modal"]', '[data-close]', '[data-modal-close]',
          'button[class*="close-modal"]', 'button[class*="modal-close"]',
          'button[class*="popup-close"]', 'button[class*="close-popup"]',
          'button[class*="closePopup"]', 'button[class*="popupClose"]',
          // Country / region / locale selectors
          '[class*="country-selector"] button:first-of-type',
          '[id*="country-selector"] button:first-of-type',
          '[class*="region-selector"] button:first-of-type',
          '[class*="locale-selector"] button:first-of-type',
          // Age verification
          '[class*="age-gate"] button[class*="yes"]',
          '[class*="age-gate"] button[class*="enter"]',
          '[id*="age-gate"] button',
          // Newsletter / email capture dismiss
          '[class*="newsletter"] [class*="close"]',
          '[class*="email-popup"] [class*="close"]',
          '[class*="subscribe-popup"] [class*="close"]',
        ]
        for (const sel of closeSelectors) {
          const el = document.querySelector(sel) as HTMLElement | null
          if (el && el.getBoundingClientRect().width > 0) { el.click(); break }
        }
      })

      // Step 2: Escape key closes most native dialog/modal patterns
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)

      // Step 3: Remove remaining high-z-index fixed overlays from DOM entirely
      await page.evaluate(() => {
        const overlaySelectors = [
          '[id*="modal"]', '[id*="popup"]', '[id*="overlay"]', '[id*="cookie"]',
          '[id*="consent"]', '[id*="gdpr"]', '[id*="age-gate"]', '[id*="country-selector"]',
          '[class*="modal"]', '[class*="popup"]', '[class*="overlay"]',
          '[class*="cookie"]', '[class*="consent"]', '[class*="gdpr"]',
          '[class*="country-selector"]', '[class*="locale-selector"]',
          '[class*="age-gate"]', '[class*="age-verify"]',
          '[class*="newsletter-popup"]', '[class*="email-capture"]',
        ]
        overlaySelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            const h = el as HTMLElement
            if (!h.style) return
            const cs = window.getComputedStyle(h)
            const zIdx = parseInt(cs.zIndex, 10)
            const pos = cs.position
            if ((pos === 'fixed' || pos === 'absolute') && zIdx >= 100) {
              const rect = h.getBoundingClientRect()
              // Only remove if it covers a significant area of the viewport
              if (rect.width > window.innerWidth * 0.3 || rect.height > window.innerHeight * 0.25) {
                h.remove()
              }
            }
          })
        })
        // Restore body/html scroll that overlays typically lock
        if (document.body) document.body.style.removeProperty('overflow')
        document.documentElement?.style.removeProperty('overflow')
      })
    } catch { /* modal dismissal is best-effort — never fail the extraction */ }

    // Helper: run a page.evaluate, but if the context was destroyed by a
    // mid-evaluation navigation, wait for the page to settle and retry once.
    async function safeEvaluate<T>(fn: () => T): Promise<T | undefined> {
      try {
        return await page.evaluate(fn)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('Execution context was destroyed') || msg.includes('navigation')) {
          await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {})
          try { return await page.evaluate(fn) } catch { /* give up */ }
        }
      }
    }

    // ── Pre-pass: Remove app-based content gates BEFORE any scrolling ────────────
    // EasyLockdown and similar Shopify apps wrap ALL page content in a
    // div.easylockdown-content with style="display:none" pending JS auth.
    // This MUST run before scroll passes so product section images
    // become visible and load during the scroll phase below.
    await page.evaluate(() => {
      document.querySelectorAll(
        '.easylockdown-content, [class*="easylockdown"], [id*="easylockdown"],' +
        '.lockdown-content, [class*="content-gate"], [class*="contentgate"],' +
        '[data-lockdown], [data-content-gate]'
      ).forEach(el => {
        const h = el as HTMLElement
        h.style.removeProperty('display')
        h.style.removeProperty('visibility')
        h.style.removeProperty('opacity')
        h.removeAttribute('hidden')
      })
      // Also force all lazy images eager so they load during the scroll passes
      document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        (img as HTMLImageElement).loading = 'eager'
      })
    })

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
        if (bg) {
          const h = el as HTMLElement
          h.style.setProperty('--clone-bg', `url(${bg})`)
          h.style.setProperty('background-image', 'var(--clone-bg)', 'important')
        }
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
          htmlEl.removeAttribute('aria-hidden')
          htmlEl.removeAttribute('hidden')
          htmlEl.style.removeProperty('display')
          htmlEl.style.removeProperty('visibility')
          htmlEl.style.removeProperty('opacity')
          htmlEl.style.removeProperty('transform')
          htmlEl.style.removeProperty('position')
          htmlEl.style.removeProperty('left')
          htmlEl.style.removeProperty('right')
          htmlEl.style.removeProperty('top')
          htmlEl.style.removeProperty('pointer-events')
          htmlEl.style.removeProperty('width')
        })
      })

      // Force Shopify Splide slides: remove is-hidden class and aria states
      document.querySelectorAll('.splide__slide.is-hidden, .splide__slide[aria-hidden]').forEach((el) => {
        el.classList.remove('is-hidden')
        el.removeAttribute('aria-hidden')
      })

      // Reset carousel list transform so off-screen slides aren't clipped during screenshot.
      // cleanHtml handles final layout normalization (overflow, writing-mode, flex grid).
      document.querySelectorAll('.splide__list, .swiper-wrapper, .slick-track, [class*="slides-wrapper"]').forEach((el) => {
        const htmlEl = el as HTMLElement
        htmlEl.style.removeProperty('transform')
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
        /* Reveal inline-style hidden elements (opacity:0, visibility:hidden).
           Exclude decimal values (opacity: 0.5 etc.) — the substring "opacity: 0"
           would otherwise match "opacity: 0.5" and force overlays fully opaque. */
        *[style*="opacity: 0"]:not([style*="opacity: 0."]):not(script):not(style),
        *[style*="opacity:0"]:not([style*="opacity:0."]):not(script):not(style) {
          opacity: 1 !important;
        }
        *[style*="visibility: hidden"] { visibility: visible !important; }
        /* Force all carousel slides visible — Splide, Swiper, Slick */
        .splide__slide, .swiper-slide, .slick-slide,
        [class*="slide-item"], [class*="slider__slide"], [class*="slideshow__slide"] {
          opacity: 1 !important;
          visibility: visible !important;
          pointer-events: auto !important;
          position: relative !important;
          transform: none !important;
          left: auto !important;
          top: auto !important;
          right: auto !important;
          display: block !important;
        }
        /* Unwrap carousel overflow clips so all slides render side-by-side */
        .splide__track, .slick-list, .swiper-container, .swiper,
        [class*="slides-track"], [class*="carousel__track"] {
          overflow: visible !important;
        }
        /* Make carousel lists wrap instead of clipping off-screen slides */
        .splide__list, .swiper-wrapper, .slick-track,
        [class*="slides-wrapper"], [class*="carousel__list"] {
          display: flex !important;
          flex-wrap: wrap !important;
          transform: none !important;
          width: auto !important;
        }
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

    // ── Pass 4c: Force computed opacity:0 / visibility:hidden elements visible ──
    // Runs on ALL pages. CSS class-based opacity/visibility (used by Apple hero
    // carousels, animated landing pages, etc.) won't be caught by the inline-style
    // overrides in the <style> tag above — only a computed-style walk wins here.
    await page.evaluate(() => {
      const skipRe = /cart[-_]?(?:drawer|notification|items|footer|form)|modal|popup|overlay|sidebar|predictive[-_]?search|search[-_]?modal|quick[-_]?(?:add|view|order)|age[-_]?(?:ver|gate)|cookie|consent|gdpr|intercom|drift|crisp|hubspot/i
      document.querySelectorAll('body *').forEach((el) => {
        const id = el.id ?? ''
        const cls = typeof el.className === 'string' ? el.className : ''
        if (skipRe.test(id + ' ' + cls)) return
        const closestSkip = el.closest('[id*="cart-drawer"],[id*="cart-notification"],[class*="cart-drawer"],[id*="modal"],[id*="popup"],[id*="predictive-search"]')
        if (closestSkip) return

        const h = el as HTMLElement
        const cs = window.getComputedStyle(h)
        if (parseFloat(cs.opacity) < 0.1) h.style.setProperty('opacity', '1', 'important')
        if (cs.visibility === 'hidden') h.style.setProperty('visibility', 'visible', 'important')
        // Clear blur filters — Apple/animated sites start elements blurred as part
        // of entrance animations; without JS running the transition they stay blurry.
        // Use setProperty with 'important' to beat CSS !important class rules.
        const filter = cs.filter || (cs as CSSStyleDeclaration & {webkitFilter?: string}).webkitFilter || ''
        if (filter && filter !== 'none' && filter.includes('blur')) {
          h.style.setProperty('filter', 'none', 'important')
          h.style.setProperty('-webkit-filter', 'none', 'important')
        }
        // Extract computed background-image and inline it so JS-set backgrounds
        // (hero sections, card thumbnails set via JS/CSS vars) survive without JS.
        // Use CSS custom property instead of setting backgroundImage directly:
        // Chrome re-adds quotes to url() in CSSOM → url(&quot;...&quot;) in outerHTML
        // which corrupts downstream URL replacement. Custom property values are
        // stored verbatim — no quote normalization — so --clone-bg: url(https://...)
        // serializes cleanly and the URL replacement finds the exact original URL.
        const computedBg = cs.backgroundImage
        if (
          computedBg &&
          computedBg !== 'none' &&
          computedBg.includes('url(') &&
          !computedBg.includes('gradient') &&
          !h.style.backgroundImage
        ) {
          const bgMatch = computedBg.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)
          if (bgMatch) {
            const rawUrl = bgMatch[1].trim()
            h.style.setProperty('--clone-bg', `url(${rawUrl})`)
            h.style.setProperty('background-image', 'var(--clone-bg)', 'important')
          }
        }
        // Resolve CSS variable colors so static clone doesn't lose them when JS is stripped
        const inlineBg = h.style.backgroundColor
        if (inlineBg && inlineBg.startsWith('var(')) h.style.backgroundColor = cs.backgroundColor
        const inlineColor = h.style.color
        if (inlineColor && inlineColor.startsWith('var(')) h.style.color = cs.color
      })
    })

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

    // Bumped 1.5s → 4s: catches IntersectionObserver-driven content (delayed
    // marketing sections, lazy-mounted SPA modules) that fire on a timer or
    // after the second scroll pass. Adds ~2.5s to every clone but recovers
    // sections that otherwise never make it into the DOM snapshot.
    await page.waitForTimeout(4000)

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

      if (document.body) {
        const consentBodyClasses = ['consent-required', 'no-consent', 'gdpr-required', 'cookie-required', 'privacy-required']
        consentBodyClasses.forEach(cls => document.body.classList.remove(cls))

        document.body.style.removeProperty('display')
        document.body.style.removeProperty('visibility')
        document.documentElement.style.removeProperty('overflow')
        document.body.style.removeProperty('overflow')
        document.documentElement.style.setProperty('overflow-y', 'auto', 'important')
        document.body.style.setProperty('overflow-y', 'auto', 'important')
      }

      // ── Remove app-based content gates ────────────────────────────────────────
      // EasyLockdown (and similar Shopify apps) wrap ALL page content in a
      // div.easylockdown-content with style="display:none" and rely on their
      // JS to remove it after an auth check. Our headless browser has no session
      // cookie so the gate stays locked forever, hiding the entire product section.
      // Forcibly unwrap it here so Playwright captures the real content.
      document.querySelectorAll(
        '.easylockdown-content, [class*="easylockdown"], [id*="easylockdown"]'
      ).forEach(el => {
        const h = el as HTMLElement
        h.style.removeProperty('display')
        h.style.removeProperty('visibility')
        h.style.removeProperty('opacity')
      })
    })

    await page.waitForTimeout(300)

    // ── Pre-capture: Fix ALL vertical writing-mode via computed styles ───────────
    // Runs here (after ALL scroll/AJAX passes) so dynamically-loaded content like
    // Shopify product recommendations is already in the DOM.
    // We check every element in the body — not just known carousel selectors — so
    // this works regardless of the theme's class names.
    // Wrapped in try/catch: nike.com client-side soft-navigates mid-extraction.
    // If document.body becomes null we lose this pass but the rest of extraction
    // continues — better than failing the whole clone.
    let writingModeFixed = { count: 0, sample: [] as string[] }
    try {
      writingModeFixed = await page.evaluate(() => {
        if (!document.body) return { count: 0, sample: [] as string[] }
        let count = 0
        const sample: string[] = []
        document.body.querySelectorAll('*').forEach(el => {
          const tag = el.tagName
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK') return
          const h = el as HTMLElement
          if (!h.style) return
          const cs = window.getComputedStyle(h)
          if (cs.writingMode !== 'horizontal-tb') {
            h.style.setProperty('writing-mode', 'horizontal-tb', 'important')
            h.style.setProperty('text-orientation', 'mixed', 'important')
            const w = parseFloat(cs.width)
            if (!isNaN(w) && w > 0 && w < 40) {
              h.style.setProperty('width', 'auto', 'important')
              h.style.setProperty('min-width', '60px', 'important')
            }
            count++
            if (sample.length < 5) sample.push(`${tag}.${String(el.className).slice(0, 40)}`)
          }
        })
        return { count, sample }
      })
      console.log(`[extractor] Writing-mode fixed on ${writingModeFixed.count} elements:`, writingModeFixed.sample)
    } catch (err) {
      console.log('[extractor] writing-mode pass failed (non-fatal):', err instanceof Error ? err.message.slice(0, 120) : err)
    }

    // ── Wait for all images to finish loading ────────────────────────────────────
    await page.waitForFunction(
      () => [...document.images].every(img => img.complete),
      { timeout: 8000 }
    ).catch(() => {})

    // ── Replace <video> elements with poster <img> for static clone ─────────────
    // Video elements render as black boxes without JS. Swap each one out for
    // its poster image so the clone shows a meaningful still frame (Apple hero
    // sections, product demos, etc.).
    await page.evaluate(() => {
      document.querySelectorAll('video').forEach(video => {
        const poster = video.getAttribute('poster')
        if (!poster) return
        const img = document.createElement('img')
        img.src = poster
        img.className = video.className
        const inlineStyle = video.getAttribute('style') ?? ''
        img.setAttribute('style', inlineStyle)
        // Ensure the image fills the space the video occupied
        img.style.width = img.style.width || '100%'
        img.style.maxWidth = '100%'
        img.style.objectFit = img.style.objectFit || 'cover'
        img.style.display = img.style.display || 'block'
        video.replaceWith(img)
      })
    })

    // ── Extract and inline CSS from CSSOM ─────────────────────────────────────
    // Also strips writing-mode:vertical-* from rule text so the saved stylesheet
    // can't re-introduce vertical text when the browser re-evaluates it.
    await page.evaluate(() => {
      const rules: string[] = []
      const verticalWmRe = /writing-mode\s*:\s*(?:vertical-rl|vertical-lr|sideways-rl|sideways-lr)/i
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            let text = rule.cssText
            if (verticalWmRe.test(text)) {
              text = text.replace(
                /writing-mode\s*:\s*(?:vertical-rl|vertical-lr|sideways-rl|sideways-lr)/gi,
                'writing-mode: horizontal-tb'
              )
            }
            rules.push(text)
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

    // ── Pass 6: Force Salient/Nectar .row-bg background elements visible ────────────
    // Salient's CSS starts every .row-bg at opacity:0 and relies on its JavaScript to
    // add the 'top-level' class to the section, which unlocks the opacity:1 CSS rule:
    //   .parallax_section.top-level .row-bg:not([data-parallax-speed="fixed"]) { opacity: 1 }
    // The 'top-level' class is added asynchronously (IntersectionObserver callbacks) and
    // is often NOT present in the serialized outerHTML even after networkidle.
    // Without it the hero background stays at opacity:0 — invisible despite having
    // a correct background-image URL.
    // Fix: after CSSOM extraction, explicitly force opacity:1 on any .row-bg that is
    // still not fully visible, so the inline !important overrides the stylesheet rule.
    await page.evaluate(() => {
      document.querySelectorAll('.row-bg').forEach(el => {
        const h = el as HTMLElement
        const cs = window.getComputedStyle(h)
        if (parseFloat(cs.opacity) < 0.99) {
          h.style.setProperty('opacity', '1', 'important')
        }
      })
    })

    // ── Surgical empty-shell detection (runs while live page is open) ───────
    // AJAX-driven sections (product recommendations, "shop the look", reviews)
    // reserve real estate on the page even when their content fails to load.
    // The previous cheerio-side heuristic over-removed entire bodies; here we
    // use the BROWSER's ground truth: rendered height + innerText + actual
    // images + computed background-image. Mark each truly-empty shell with
    // data-igualai-empty="1"; cleanHtml later removes anything carrying that
    // attribute, no guessing required.
    try {
      const markedCount = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll(
          'section, main > div, body > div, article > div, [class*="shopify-section"], [data-section-id], [data-section-type]'
        )) as HTMLElement[]
        let marked = 0
        for (const el of candidates) {
          if (el.closest('header, footer, nav, aside')) continue
          if (el.hasAttribute('data-igualai-section')) continue

          const rect = el.getBoundingClientRect()
          if (rect.height < 200) continue

          const visibleText = (el.innerText ?? '').replace(/\s+/g, ' ').trim()
          if (visibleText.length >= 30) continue

          const realImgs = Array.from(el.querySelectorAll('img')).filter((img) => {
            const src = (img as HTMLImageElement).src ?? ''
            return src.length > 0 && !src.startsWith('data:')
          }).length
          if (realImgs > 0) continue

          // Self background-image (computed)
          const cs = window.getComputedStyle(el)
          if (cs.backgroundImage && cs.backgroundImage !== 'none') continue
          // Descendant inline url() — cheap O(1) selector vs walking computed styles
          if (el.querySelector('[style*="url("]')) continue

          el.setAttribute('data-igualai-empty', '1')
          marked++
        }

        // Outermost only: clear marker on elements nested under another marked shell.
        // Prevents double-removal and keeps nested children intact if outer is removed.
        for (const el of Array.from(document.querySelectorAll('[data-igualai-empty="1"]'))) {
          const ancestor = el.parentElement?.closest('[data-igualai-empty="1"]')
          if (ancestor) el.removeAttribute('data-igualai-empty')
        }

        return marked
      })
      console.log(`[extractor] Empty-shell pass: marked ${markedCount} sections for removal`)
    } catch (err) {
      console.log('[extractor] Empty-shell marking failed (non-fatal):', err instanceof Error ? err.message.slice(0, 100) : err)
    }

    // ── Pillar 2: Screenshot + content density measurement ───────────────────
    // Take a full-page screenshot AFTER all DOM manipulation. This is the visual
    // ground truth. If content density is sparse (SPA with JS-only content that
    // didn't load), the clone route uses Claude Vision to reconstruct from this.
    let screenshotBase64 = ''
    let contentDensity = { imgs: 0, textLen: 0, headings: 0 }
    try {
      ;[screenshotBase64, contentDensity] = await Promise.all([
        page.screenshot({ fullPage: true, type: 'jpeg', quality: 75 })
          .then(buf => buf.toString('base64')),
        page.evaluate(() => ({
          imgs: document.querySelectorAll('img[src]:not([src=""])').length,
          textLen: (document.body.innerText ?? '').replace(/\s+/g, ' ').trim().length,
          headings: document.querySelectorAll('h1,h2,h3').length,
        })),
      ])
      console.log(`[extractor] Pillar 2: imgs=${contentDensity.imgs} textLen=${contentDensity.textLen} headings=${contentDensity.headings}`)
    } catch (err) {
      console.log('[extractor] Pillar 2 screenshot failed (non-fatal):', err)
    }

    // ── Bug 1 fix: Framework detection MUST run inside the browser ──────────
    // The previous implementation regex-matched the HTML *after* cleanHtml had
    // stripped <script id="__NEXT_DATA__"> and other framework markers — so
    // detection always returned false and Vision reconstruction was dead code.
    // Detect here while window globals (__NEXT_DATA__, __NUXT__, ng, etc.) and
    // raw shell markers (#__next, #__nuxt, [data-reactroot]) are still live.
    let frameworkDetected: FrameworkSignal = null
    try {
      frameworkDetected = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any
        if (w.__NEXT_DATA__ || document.getElementById('__NEXT_DATA__') || document.getElementById('__next')) {
          return 'next'
        }
        if (w.__NUXT__ || document.getElementById('__nuxt') || document.getElementById('__nuxt__')) {
          return 'nuxt'
        }
        if (document.querySelector('[ng-version]') || w.ng?.probe || w.getAllAngularRootElements) {
          return 'angular'
        }
        if (w.Vue || w.__VUE__ || document.querySelector('[data-v-app]')) {
          return 'vue'
        }
        if (
          document.querySelector('[data-reactroot]') ||
          w.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size > 0
        ) {
          return 'react'
        }
        // Empty SPA shell — common React/Vue mount points with no rendered children
        const shell = document.querySelector('#root, #app')
        if (shell && shell.children.length === 0) return 'spa-shell'
        return null
      }) as FrameworkSignal
      console.log(`[CLONE] frameworkDetected=${frameworkDetected ?? 'none'}`)
    } catch (err) {
      console.log('[CLONE] framework detection failed (non-fatal):', err)
    }

    // ── Pre-serialization: convert inline background-image to CSS custom property ──
    // Chrome ALWAYS re-adds double quotes to url() when you assign to style.backgroundImage
    // (even if you assign url(https://...) without quotes, Chrome normalises it back to
    // url("https://...") internally). This means outerHTML always contains
    // url(&quot;https://...&quot;) which corrupts downstream URL replacement.
    // CSS custom properties bypass CSSOM quote normalisation entirely: the browser stores
    // the value literally and serialises it verbatim — so --clone-bg: url(https://...)
    // appears in outerHTML exactly as written, without &quot; encoding.
    // The browser resolves var(--clone-bg) on the same element correctly when rendering.
    await page.evaluate(() => {
      document.querySelectorAll('[style]').forEach(el => {
        const h = el as HTMLElement
        const bg = h.style.backgroundImage
        if (!bg || bg === 'none' || bg.startsWith('var(')) return
        const match = bg.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)
        if (!match) return
        const rawUrl = match[1].trim()
        if (!rawUrl || rawUrl.startsWith('data:')) return
        h.style.setProperty('--clone-bg', `url(${rawUrl})`)
        h.style.setProperty('background-image', 'var(--clone-bg)', 'important')
      })
    })

    const tBeforeSerialize = Date.now()
    const html = await page.evaluate(() => document.documentElement.outerHTML)
    console.log(`[CLONE-DEBUG] stage=extract.serialize htmlLen=${html.length} bodyLen=${(html.match(/<body[\s\S]*<\/body>/i)?.[0]?.length ?? 0)} extractMs=${tBeforeSerialize - tNav}`)

    // Wait for all in-flight R2 uploads to complete (max 30s)
    if (uploadPromises.length > 0) {
      console.log(`[extractor] Waiting for ${uploadPromises.length} R2 uploads...`)
      await Promise.race([
        Promise.allSettled(uploadPromises),
        new Promise<void>(resolve => setTimeout(resolve, 30000)),
      ])
      console.log(`[extractor] Intercepted and uploaded ${urlMap.size} resources to R2`)
    }

    return { html, urlMap, screenshotBase64, contentDensity, frameworkDetected }
  } finally {
    await browser.close()
  }
}
