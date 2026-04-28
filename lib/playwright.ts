export interface ScrapeResult {
  html: string
  screenshotBase64: string
  title: string
  error?: string
}

export async function scrapeWebsite(
  url: string,
  onProgress?: (step: string) => void
): Promise<ScrapeResult> {
  try {
    const { chromium } = await import('playwright')

    onProgress?.('Launching browser...')
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })

    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      })

      const page = await context.newPage()

      onProgress?.(`Visiting ${url}...`)
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      })

      // Wait for the network to settle after initial load
      await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {})

      // Dismiss cookie consent banners, modals, and overlays before scrolling
      try {
        // Press Escape to close any modal that responds to it
        await page.keyboard.press('Escape')

        // Click the first matching dismiss/accept button found on the page
        const dismissLabels = [
          'Accept All',
          'Accept Cookies',
          'Accept all cookies',
          'Accept all',
          'Accept',
          'I agree',
          'I Accept',
          'Agree',
          'Got it',
          'OK',
          'Okay',
          'Close',
          'No thanks',
          'No, thanks',
          'Dismiss',
          'Continue',
          'Allow',
          'Allow all',
          'Allow All Cookies',
          'Consent',
        ]

        for (const label of dismissLabels) {
          const btn = page.getByRole('button', { name: label, exact: false })
          if (await btn.first().isVisible({ timeout: 500 }).catch(() => false)) {
            await btn.first().click({ timeout: 1000 }).catch(() => {})
            break
          }
        }

        // Also try common cookie banner selectors as a fallback
        const bannerSelectors = [
          '[id*="cookie"] button',
          '[class*="cookie"] button',
          '[id*="consent"] button',
          '[class*="consent"] button',
          '[id*="banner"] button',
          '[class*="banner"] button',
          '[aria-label*="cookie" i]',
          '[aria-label*="consent" i]',
        ]
        for (const sel of bannerSelectors) {
          const el = page.locator(sel).first()
          if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
            await el.click({ timeout: 1000 }).catch(() => {})
            break
          }
        }

        // Short pause for any dismiss animations to complete
        await page.waitForTimeout(500)
      } catch {
        // Never fail scraping because of a banner/popup dismissal error
      }

      onProgress?.('Extracting HTML and CSS...')

      // Scroll down the full page in steps to trigger lazy-loaded images,
      // infinite scroll sections, and CSS animations
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          const distance = 400        // px per scroll step
          const delay = 1000          // ms between steps
          const maxScrollTime = 15000 // bail out after 15s regardless
          const start = Date.now()
          let lastHeight = 0

          const timer = setInterval(() => {
            window.scrollBy(0, distance)
            const scrolled = window.scrollY + window.innerHeight
            const total = document.body.scrollHeight

            // Stop if we hit the bottom or the page keeps growing past 8s
            if (
              scrolled >= total ||
              total === lastHeight ||
              Date.now() - start > maxScrollTime
            ) {
              clearInterval(timer)
              window.scrollTo(0, 0)   // scroll back to top for screenshot
              resolve()
            }
            lastHeight = total
          }, delay)
        })
      })

      // Give lazy-loaded images and animations a moment to settle
      await page.waitForTimeout(1000)

      // Wait for all images in the viewport to finish loading
      await page.evaluate(async () => {
        const imgs = Array.from(document.querySelectorAll('img'))
        await Promise.all(
          imgs
            .filter((img) => !img.complete)
            .map(
              (img) =>
                new Promise<void>((res) => {
                  img.onload = () => res()
                  img.onerror = () => res()   // don't block on broken images
                  setTimeout(res, 3000)        // max 3s per image
                })
            )
        )
      })

      // Wait for any lazy-loaded network requests to finish
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

      onProgress?.('Taking screenshot...')

      // Cap the screenshot height at 4000px to stay within Claude API limits.
      // If the page is taller, clip to 4000px from the top.
      const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      const screenshotBuffer = await page.screenshot({
        fullPage: false,
        clip:
          pageHeight > 4000
            ? { x: 0, y: 0, width: 1440, height: 4000 }
            : undefined,
        type: 'jpeg',
        quality: 80,
      })
      const screenshotBase64 = screenshotBuffer.toString('base64')

      // Extract the full HTML after all content has loaded and rendered
      const title = await page.title()
      const html = await page.evaluate(() => document.documentElement.outerHTML)

      await context.close()
      await browser.close()

      onProgress?.('Generating clone...')
      return { html, screenshotBase64, title }
    } catch (err) {
      await browser.close()
      throw err
    }
  } catch (err: unknown) {
    const error = err as Error
    if (
      error.message?.includes('Executable doesn') ||
      error.message?.includes('browserType.launch') ||
      error.message?.includes('chromium')
    ) {
      throw new Error(
        'Playwright browsers not installed. Run: npx playwright install chromium'
      )
    }
    throw error
  }
}
