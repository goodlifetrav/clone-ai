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

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

    // Force all lazy-loaded images to eager before scrolling so they begin fetching immediately
    await page.evaluate(() => {
      document.querySelectorAll('img[loading="lazy"]').forEach((img) => {
        img.setAttribute('loading', 'eager')
      })
    })

    // Scroll the full page height to trigger lazy-loaded images and JS sections
    // Use 400ms delay (up from 200ms) to give Framer/React lazy loaders more time per viewport
    await page.evaluate(async () => {
      const totalHeight = document.documentElement.scrollHeight
      const step = window.innerHeight
      for (let y = 0; y < totalHeight; y += step) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 400))
      }
      window.scrollTo(0, 0)
    })

    // Let any scroll-triggered network requests and animations settle
    await page.waitForTimeout(4000)

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
    await page.evaluate(() => {
      const selectors = [
        '[id*="cookie"]', '[class*="cookie"]',
        '[id*="consent"]', '[class*="consent"]',
        '[id*="gdpr"]', '[class*="gdpr"]',
        '[id*="privacy-banner"]', '[class*="privacy-banner"]',
        '[id*="cc-"]', '[class*="cc-banner"]',
        '[id*="CookieBanner"]', '[class*="CookieBanner"]',
        '[id*="cookiebanner"]', '[class*="cookiebanner"]',
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
    })

    // Brief pause for the style injection to apply
    await page.waitForTimeout(300)

    // Freeze live-rendered dimensions on images and their containers.
    // Framer/Next.js sites size components via CSS custom properties set by JS
    // (e.g. width: var(--framer-component-width)). Without JS in a static clone,
    // those vars are unset → containers collapse and images render at natural (huge) sizes.
    // Fix: snapshot the correct rendered dimensions from getBoundingClientRect while
    // JS is still running, then inject them as inline styles that survive without JS.
    await page.evaluate(() => {
      document.querySelectorAll('img').forEach((img) => {
        // Skip unloaded images
        if (!img.complete || img.naturalWidth === 0) return
        const imgRect = img.getBoundingClientRect()
        if (imgRect.width === 0 || imgRect.height === 0) return

        const renderedW = Math.round(imgRect.width)
        const renderedH = Math.round(imgRect.height)

        // Only process images that CSS is significantly constraining
        // (rendered << natural means a container is clamping the image)
        if (renderedW >= img.naturalWidth * 0.9) return

        const imgCs = window.getComputedStyle(img)

        // Freeze img dimensions so it keeps its correct size without CSS vars
        img.style.width = renderedW + 'px'
        img.style.height = renderedH + 'px'
        if (imgCs.objectFit && imgCs.objectFit !== 'fill' && !img.style.objectFit) {
          img.style.objectFit = imgCs.objectFit
        }

        // Walk up the DOM to find and freeze the constraining container
        // (this captures circular-clip, overflow:hidden, and border-radius)
        let parent = img.parentElement
        for (let i = 0; i < 4 && parent && parent !== document.body; i++) {
          const pRect = parent.getBoundingClientRect()
          if (pRect.width === 0) { parent = parent.parentElement; continue }

          // This ancestor is approximately the same size → it's the constraint container
          if (pRect.width <= renderedW * 1.2 && pRect.height <= renderedH * 1.2) {
            const pCs = window.getComputedStyle(parent)
            if (!parent.style.width) parent.style.width = Math.round(pRect.width) + 'px'
            if (!parent.style.height) parent.style.height = Math.round(pRect.height) + 'px'
            if (!parent.style.borderRadius && pCs.borderRadius !== '0px') {
              parent.style.borderRadius = pCs.borderRadius
            }
            if (!parent.style.overflow && pCs.overflow !== 'visible') {
              parent.style.overflow = pCs.overflow
            }
            break
          }
          parent = parent.parentElement
        }
      })
    })

    // Replace <video> elements with a <div> that keeps the exact same class and inline styles.
    // Headless Chromium doesn't autoplay videos — they render as black rectangles.
    // We use a plain div (not a poster <img>) because poster images lack the CSS constraints
    // that Framer/React apply to the video via its class names — they'd render huge.
    // The div inherits all Framer layout classes so it occupies the same space as the video.
    await page.evaluate(() => {
      document.querySelectorAll('video').forEach((video) => {
        const placeholder = document.createElement('div')
        placeholder.className = video.className
        // Preserve inline styles (Framer sets position/dimensions here)
        if (video.style.cssText) placeholder.style.cssText = video.style.cssText
        // Dark neutral fill — blends on dark sites, unobtrusive on light sites
        placeholder.style.background = '#111111'
        video.parentNode?.replaceChild(placeholder, video)
      })
    })

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
