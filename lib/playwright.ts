export interface ScrapeResult {
  html: string
  screenshotBase64: string
  title: string
  error?: string
}

interface ImageInfo {
  /** currentSrc || img.src — the URL that was actually loaded; used for downloading */
  src: string
  /** img.src — browser-absolutified src attribute; matches what absolutifyHtml produces */
  attrSrc: string
  width: number
  height: number
}

/**
 * Convert all relative URLs in scraped HTML to absolute URLs so that
 * images, stylesheets, and other assets load from the original domain
 * when the clone is rendered.
 */
function absolutifyHtml(html: string, pageUrl: string): string {
  const base = new URL(pageUrl)

  const resolve = (url: string): string => {
    if (!url) return url
    const trimmed = url.trim()
    // Already absolute or a special scheme — leave untouched
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('blob:') ||
      trimmed.startsWith('mailto:') ||
      trimmed.startsWith('tel:') ||
      trimmed.startsWith('#')
    ) {
      return url
    }
    try {
      return new URL(trimmed, base).href
    } catch {
      return url
    }
  }

  return (
    html
      // src="..." — images, iframes, scripts, audio, video, etc.
      .replace(/\bsrc=(['"])([^'"]*)\1/gi, (_, q, url) => `src=${q}${resolve(url)}${q}`)
      // srcset="url 1x, url 2x" — responsive images
      .replace(/\bsrcset=(['"])([^'"]*)\1/gi, (_, q, srcset) => {
        const fixed = srcset.replace(/(^|,\s*)([^\s,][^\s,]*)/g, (m: string, sep: string, candidate: string) => {
          // candidate may be "url descriptor" or just "url"
          const parts = candidate.trim().split(/\s+/)
          parts[0] = resolve(parts[0])
          return sep + parts.join(' ')
        })
        return `srcset=${q}${fixed}${q}`
      })
      // href="..." on <link> tags (stylesheets, icons) — NOT <a> tags
      .replace(/(<link\b[^>]*?\bhref=)(['"])([^'"]*)\2/gi, (_, pre, q, url) => `${pre}${q}${resolve(url)}${q}`)
      // CSS url() inside <style> blocks and inline style=""
      .replace(/\burl\((['"]?)([^'")]+)\1\)/gi, (_, q, url) => `url(${q}${resolve(url)}${q})`)
  )
}

/**
 * Download images from the page using the browser context (same session /
 * cookies as the page, so hotlink protection is bypassed) and upload them
 * to Cloudflare R2.  Returns a map of original absolute URL → R2 URL.
 *
 * Limits: top 20 images by DOM order, ≥50×50 px, ≤2 MB.
 */
async function mirrorImagesToR2(
  images: ImageInfo[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  browserContext: any,
  projectId: string,
  onProgress?: (step: string) => void
): Promise<Map<string, string>> {
  console.log(`[R2] Starting image mirror for project: ${projectId}`)
  console.log(`[R2] Total images found on page: ${images.length}`)

  const { isR2Configured, uploadToR2 } = await import('./r2')

  const configured = isR2Configured()
  if (!configured) {
    const missing = [
      'CLOUDFLARE_R2_ENDPOINT',
      'CLOUDFLARE_R2_ACCESS_KEY_ID',
      'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
      'CLOUDFLARE_R2_BUCKET',
      'CLOUDFLARE_R2_PUBLIC_URL',
    ].filter((k) => !process.env[k])
    console.log(`[R2] isR2Configured() = false — missing env vars: ${missing.join(', ')}`)
    return new Map()
  }
  console.log('[R2] isR2Configured() = true')

  const { createHash } = await import('crypto')

  // Skip PDFs and non-photo document URLs
  const SKIP_PATTERNS = /\.pdf($|\?)|energy|label|document|fiche|datasheet/i

  // Deduplicate by attrSrc (the HTML-matching key), filter by minimum dimensions, take top 20
  const seen = new Set<string>()
  const candidates = images.filter((img) => {
    const key = img.attrSrc || img.src
    if (!key || seen.has(key)) return false
    seen.add(key)
    if (SKIP_PATTERNS.test(key)) {
      console.log(`[R2] Skipped (document/PDF): ${key}`)
      return false
    }
    return img.width >= 50 && img.height >= 50
  }).slice(0, 20)

  console.log(`[R2] Candidates after dedup + size filter (≥50×50): ${candidates.length}`)
  if (candidates.length === 0) return new Map()
  onProgress?.(`Uploading ${candidates.length} images to storage…`)

  const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

  const entries = await Promise.allSettled(
    candidates.map(async (img): Promise<[string, string] | null> => {
      // Download from the actually-loaded URL (currentSrc); match in HTML by attrSrc (img.src attr)
      const downloadUrl = img.src
      const htmlKey = img.attrSrc || img.src
      console.log(`[R2] Attempting upload: ${downloadUrl} (htmlKey: ${htmlKey}, ${img.width}×${img.height})`)
      try {
        const res = await browserContext.request.get(downloadUrl, { timeout: 15000 })
        if (!res.ok()) {
          console.log(`[R2] Skipped (HTTP ${res.status()}): ${downloadUrl}`)
          return null
        }

        const buffer = Buffer.from(await res.body())
        if (buffer.length > MAX_BYTES) {
          console.log(`[R2] Skipped (too large ${buffer.length} bytes): ${downloadUrl}`)
          return null
        }

        const contentType: string =
          (res.headers()['content-type'] || 'image/jpeg').split(';')[0].trim()
        const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
        const hash = createHash('md5').update(htmlKey).digest('hex').slice(0, 16)
        const key = `projects/${projectId}/${hash}.${ext}`

        const r2Url = await uploadToR2(buffer, key, contentType)
        console.log(`[R2] Uploaded: ${htmlKey} → ${r2Url}`)
        // Key is the attrSrc so it matches the absolutified HTML
        return [htmlKey, r2Url]
      } catch (err) {
        console.log(`[R2] Error uploading ${downloadUrl}:`, err)
        return null
      }
    })
  )

  const urlMap = new Map<string, string>()
  for (const result of entries) {
    if (result.status === 'fulfilled' && result.value) {
      urlMap.set(result.value[0], result.value[1])
    }
  }
  console.log(`[R2] Mirror complete. Uploaded ${urlMap.size}/${candidates.length} images.`)
  return urlMap
}

export async function scrapeWebsite(
  url: string,
  onProgress?: (step: string) => void,
  projectId?: string
): Promise<ScrapeResult> {
  console.log(`[SCRAPE] Starting scrape: url=${url} projectId=${projectId ?? '(none)'}`)
  try {
    const { chromium } = await import('playwright')

    onProgress?.('Launching browser...')
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })

    try {
      const USER_AGENTS = [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
      ]

      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        locale: 'en-US',
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
        },
        geolocation: { latitude: 37.7749, longitude: -122.4194 },
        permissions: ['geolocation'],
      })

      const page = await context.newPage()

      onProgress?.(`Visiting ${url}...`)
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      })

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

      await page.waitForTimeout(2000)

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

      // Full page screenshot up to 8000px so Claude gets the complete layout.
      // Pages taller than 8000px are clipped to avoid exceeding Claude's image size limits.
      const SCREENSHOT_MAX_HEIGHT = 8000
      const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      const screenshotBuffer = await page.screenshot({
        fullPage: pageHeight <= SCREENSHOT_MAX_HEIGHT,
        clip:
          pageHeight > SCREENSHOT_MAX_HEIGHT
            ? { x: 0, y: 0, width: 1920, height: SCREENSHOT_MAX_HEIGHT }
            : undefined,
        type: 'jpeg',
        quality: 70,
      })
      const screenshotBase64 = screenshotBuffer.toString('base64')

      // Extract the full HTML after all content has loaded and rendered
      const title = await page.title()
      const rawHtml = await page.content()

      // Collect image metadata (src, rendered dimensions) before closing context.
      // attrSrc = img.src property (browser-absolutified src attribute) — this is what
      // absolutifyHtml will produce in the HTML string, so it's our map key for replacement.
      // src = currentSrc || img.src — the actually-loaded URL (may differ via srcset).
      const imageInfos: ImageInfo[] = projectId
        ? await page.evaluate((): ImageInfo[] =>
            Array.from(document.querySelectorAll('img'))
              .map((img) => {
                const el = img as HTMLImageElement
                return {
                  src: el.currentSrc || el.src,
                  attrSrc: el.src,
                  width: el.naturalWidth,
                  height: el.naturalHeight,
                }
              })
              .filter((i) => i.attrSrc.startsWith('http'))
          )
        : []

      // Mirror images to R2 while context is still open (uses browser session for downloads)
      console.log(`[R2] projectId=${projectId ?? '(none)'}, imageInfos.length=${imageInfos.length}`)
      const r2UrlMap =
        projectId && imageInfos.length > 0
          ? await mirrorImagesToR2(imageInfos, context, projectId, onProgress)
          : new Map<string, string>()

      await context.close()
      await browser.close()

      // Convert relative URLs → absolute so Claude preserves real image/asset URLs
      let absoluteHtml = absolutifyHtml(rawHtml, url)

      // Replace original image URLs with R2-hosted copies
      if (r2UrlMap.size > 0) {
        let replacements = 0
        for (const [orig, r2] of r2UrlMap) {
          const before = absoluteHtml
          absoluteHtml = absoluteHtml.split(orig).join(r2)
          if (absoluteHtml !== before) {
            replacements++
            console.log(`[R2] Replaced in HTML: ${orig}`)
          } else {
            // Exact match failed — try URL-decoded variant (handles %20 etc.)
            const decoded = decodeURIComponent(orig)
            if (decoded !== orig) {
              const before2 = absoluteHtml
              absoluteHtml = absoluteHtml.split(decoded).join(r2)
              if (absoluteHtml !== before2) {
                replacements++
                console.log(`[R2] Replaced in HTML (decoded): ${decoded}`)
              } else {
                console.log(`[R2] NO MATCH in HTML for: ${orig}`)
                // Log a snippet of the HTML near where we'd expect the URL to appear
                const stem = orig.split('/').pop()?.split('?')[0] ?? ''
                if (stem) {
                  const idx = absoluteHtml.indexOf(stem)
                  if (idx !== -1) {
                    console.log(`[R2]   Nearby HTML: ...${absoluteHtml.slice(Math.max(0, idx - 40), idx + stem.length + 40)}...`)
                  } else {
                    console.log(`[R2]   filename stem "${stem}" not found in HTML either`)
                  }
                }
              }
            } else {
              console.log(`[R2] NO MATCH in HTML for: ${orig}`)
              const stem = orig.split('/').pop()?.split('?')[0] ?? ''
              if (stem) {
                const idx = absoluteHtml.indexOf(stem)
                if (idx !== -1) {
                  console.log(`[R2]   Nearby HTML: ...${absoluteHtml.slice(Math.max(0, idx - 40), idx + stem.length + 40)}...`)
                } else {
                  console.log(`[R2]   filename stem "${stem}" not found in HTML either`)
                }
              }
            }
          }
        }
        console.log(`[R2] HTML replacement done: ${replacements}/${r2UrlMap.size} URLs replaced`)
      }

      onProgress?.('Generating clone...')
      return { html: absoluteHtml, screenshotBase64, title }
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
