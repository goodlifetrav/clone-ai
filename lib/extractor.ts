/**
 * extractSite — DOM extraction via headless Chromium
 *
 * Navigates to a URL, scrolls the full page to trigger lazy-loaded content,
 * and returns the fully-rendered outerHTML.
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

    // Scroll the full page height to trigger lazy-loaded images and JS sections
    await page.evaluate(async () => {
      const totalHeight = document.documentElement.scrollHeight
      const step = window.innerHeight
      for (let y = 0; y < totalHeight; y += step) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 200))
      }
      window.scrollTo(0, 0)
    })

    // Let any scroll-triggered network requests and animations settle
    await page.waitForTimeout(2500)

    // Force all scroll-animated elements visible — many sites use AOS, GSAP, or
    // Intersection Observer to hide elements initially (opacity:0, translateY, etc.)
    // and reveal them on scroll. Since the static clone has no JS, we override
    // these so every section is visible in the captured HTML.
    await page.addStyleTag({
      content: `
        *[style*="opacity: 0"],
        *[style*="opacity:0"] { opacity: 1 !important; }
        *[style*="visibility: hidden"] { visibility: visible !important; }
        *[style*="translateY"] { transform: none !important; }
        *[style*="translateX"] { transform: none !important; }
        .aos-init:not(.aos-animate) { opacity: 1 !important; transform: none !important; }
        [data-aos] { opacity: 1 !important; transform: none !important; transition: none !important; }
        .gsap-hidden, .is-hidden, .js-hidden { opacity: 1 !important; visibility: visible !important; }
      `
    })

    // Dismiss cookie banners before capturing
    // First try clicking Accept buttons on consent dialogs
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
        // Shopify Privacy & Compliance banner
        '[id*="shopify-pc"]', '[class*="shopify-pc"]',
        '[id*="shopify-privacy"]', '[class*="shopify-privacy"]',
        '[id*="privacy-bar"]', '[class*="privacy-bar"]',
        // Country/region selector overlays (Apple-style geo-redirect banners)
        '[id*="country"]', '[class*="country-selector"]', '[class*="locale-selector"]',
        '[id*="locale"]', '[class*="region-selector"]', '[id*="region-selector"]',
        '[class*="geo-"]', '[id*="geo-banner"]', '[class*="country-banner"]',
      ]
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove())
      })
      // Remove live chat widgets and specific modal backdrops (NOT generic overlay/backdrop —
      // Framer and other frameworks use those class names for real layout containers)
      ;[
        '[id*="intercom"]', '[class*="intercom"]',
        '[id*="drift"]', '[class*="drift"]',
        '[id*="crisp"]', '[id*="hubspot"]',
        'iframe[src*="intercom"]', 'iframe[src*="drift"]',
        '[id="modal-backdrop"]', '[id="overlay-backdrop"]',
      ].forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove())
      })

      // Remove consent-blocking body classes that hide all page content.
      // Some consent implementations add classes like "consent-required" or
      // "no-consent" to <body> and use CSS to hide everything until accepted.
      const consentBodyClasses = ['consent-required', 'no-consent', 'gdpr-required', 'cookie-required', 'privacy-required']
      consentBodyClasses.forEach(cls => document.body.classList.remove(cls))

      // Force body and html visible — catches any remaining display:none on root
      document.body.style.removeProperty('display')
      document.body.style.removeProperty('visibility')
      document.documentElement.style.removeProperty('overflow')
    })

    // Brief pause for the style injection to apply
    await page.waitForTimeout(300)

    // Extract all CSS from the browser's CSSOM and inline it.
    // This is more reliable than server-side CSS fetching because the browser
    // already has all stylesheets loaded (no CORS/CDN fetch issues).
    await page.evaluate(() => {
      const rules: string[] = []
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules ?? [])) {
            rules.push(rule.cssText)
          }
        } catch {
          // Cross-origin sheet without --disable-web-security — skip, leave link tag
        }
      }
      if (rules.length > 0) {
        // Remove all external <link rel="stylesheet"> tags (we've extracted their rules)
        document.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove())
        // Inject all extracted CSS as a single inline <style> block
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
