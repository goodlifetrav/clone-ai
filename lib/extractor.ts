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
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
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

    // Scroll the full page height to trigger lazy-loaded images and JS sections
    await page.evaluate(async () => {
      const totalHeight = document.documentElement.scrollHeight
      const step = window.innerHeight
      for (let y = 0; y < totalHeight; y += step) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 120))
      }
      window.scrollTo(0, 0)
    })

    // Let any scroll-triggered network requests settle
    await page.waitForTimeout(1500)

    return await page.evaluate(() => document.documentElement.outerHTML)
  } finally {
    await browser.close()
  }
}
