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
      // data-src="..." — lazy-loaded images (Apple, etc.)
      .replace(/\bdata-src=(['"])([^'"]*)\1/gi, (_, q, url) => `data-src=${q}${resolve(url)}${q}`)
      // data-srcset="..." — lazy-loaded responsive images
      .replace(/\bdata-srcset=(['"])([^'"]*)\1/gi, (_, q, srcset) => {
        const fixed = srcset.replace(/(^|,\s*)([^\s,][^\s,]*)/g, (m: string, sep: string, candidate: string) => {
          const parts = candidate.trim().split(/\s+/)
          parts[0] = resolve(parts[0])
          return sep + parts.join(' ')
        })
        return `data-srcset=${q}${fixed}${q}`
      })
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

  // Skip PDFs, energy labels, and non-photo document URLs
  const SKIP_PATTERNS = /\.pdf($|\?)|energy|label|document|fiche|datasheet|energy_arrow|energy-rating|euro.*rating/i

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
    return img.width >= 10 && img.height >= 10
  }).slice(0, 50)

  console.log(`[R2] Candidates after dedup + size filter (≥10×10): ${candidates.length}`)
  if (candidates.length > 0) {
    console.log(`[R2] First ${Math.min(5, candidates.length)} image URLs:`)
    candidates.slice(0, 5).forEach((img, i) => console.log(`[R2]   [${i + 1}] ${img.attrSrc || img.src} (${img.width}×${img.height})`))
  }
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

      // Always use a realistic Chrome on Mac user-agent for best compatibility
      const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: CHROME_UA,
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"macOS"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Upgrade-Insecure-Requests': '1',
        },
      })

      const page = await context.newPage()

      onProgress?.(`Visiting ${url}...`)
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      })

      // ── Pre-scrape cleanup ────────────────────────────────────────────────
      // Dismiss popups, age gates, and overlays; add human-like mouse movement.
      // Runs twice — once after initial load, once after the first scroll pass.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async function dismissPopups(pg: typeof page) {
        try {
          await pg.keyboard.press('Escape')

          // ID/class-based cookie buttons
          const idSelectors = [
            '#onetrust-accept-btn-handler',
            '.cc-accept', '.cc-allow',
            '.cookie-accept', '#cookie-accept',
            '[data-cookiebanner="accept_button"]',
            '[aria-label="Close"]',
          ]
          for (const sel of idSelectors) {
            const el = pg.locator(sel).first()
            if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
              await el.click({ timeout: 1000 }).catch(() => {})
              console.log(`[SCRAPE] Dismissed via selector: ${sel}`)
              await pg.waitForTimeout(400)
              break
            }
          }

          // Text-based consent / age-gate buttons (cookie + age gate labels combined)
          const dismissLabels = [
            'Accept all cookies', 'Accept all', 'Accept cookies', 'Accept',
            'Allow all cookies', 'Allow all', 'Allow',
            'I agree', 'I Accept', 'Agree',
            'Got it', 'OK', 'Okay',
            'Close', 'Dismiss', 'No thanks', 'No, thanks',
            'Continue', 'Consent',
            // Age gates
            'I am 18', 'I\'m of legal age', 'Yes I am', 'Enter',
          ]
          for (const label of dismissLabels) {
            const btn = pg.getByRole('button', { name: label, exact: false })
            if (await btn.first().isVisible({ timeout: 300 }).catch(() => false)) {
              await btn.first().click({ timeout: 1000 }).catch(() => {})
              console.log(`[SCRAPE] Dismissed via label: "${label}"`)
              await pg.waitForTimeout(400)
              break
            }
          }

          // Generic banner container selectors
          const bannerSelectors = [
            '[id*="cookie"] button', '[class*="cookie"] button',
            '[id*="consent"] button', '[class*="consent"] button',
            '[id*="banner"] button', '[class*="banner"] button',
            '[id*="gdpr"] button', '[class*="gdpr"] button',
            '[aria-label*="cookie" i]', '[aria-label*="consent" i]',
            '[id*="age"] button', '[class*="age-gate"] button',
          ]
          for (const sel of bannerSelectors) {
            const el = pg.locator(sel).first()
            if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
              await el.click({ timeout: 1000 }).catch(() => {})
              console.log(`[SCRAPE] Dismissed via banner selector: ${sel}`)
              await pg.waitForTimeout(400)
              break
            }
          }

          // Remove high-z-index fixed/sticky overlays that block content
          await pg.evaluate(() => {
            const toRemove: Element[] = []
            document.querySelectorAll('*').forEach((el) => {
              const style = window.getComputedStyle(el)
              const zIndex = parseInt(style.zIndex, 10)
              const pos = style.position
              if (
                (pos === 'fixed' || pos === 'sticky') &&
                zIndex > 100 &&
                (el as HTMLElement).offsetHeight > 50
              ) {
                // Keep elements that are part of the main nav/header (top of page)
                const rect = el.getBoundingClientRect()
                const isTopNav = rect.top < 80 && rect.height < 100
                if (!isTopNav) {
                  toRemove.push(el)
                }
              }
            })
            toRemove.forEach((el) => el.remove())
            if (toRemove.length > 0) {
              console.log(`[SCRAPE] Removed ${toRemove.length} overlay element(s)`)
            }
          }).catch(() => {})
        } catch {
          // Never fail scraping because of cleanup errors
        }
      }

      // Random mouse movements to pass basic bot-detection checks
      async function humaniseMouseMovement(pg: typeof page) {
        try {
          const moves = [
            { x: 300, y: 200 }, { x: 600, y: 350 }, { x: 450, y: 500 },
            { x: 800, y: 300 }, { x: 200, y: 450 },
          ]
          for (const { x, y } of moves) {
            await pg.mouse.move(x + Math.random() * 40, y + Math.random() * 40)
            await pg.waitForTimeout(80 + Math.random() * 120)
          }
        } catch { /* non-fatal */ }
      }

      // Run first cleanup pass + mouse movement immediately after load
      await dismissPopups(page)
      await humaniseMouseMovement(page)
      await page.waitForTimeout(800)

      // If the page has very little visible text, wait an extra 5 s for JS to render
      const visibleTextLength = await page.evaluate(() =>
        (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().length
      ).catch(() => 0)
      if (visibleTextLength < 500) {
        console.log(`[SCRAPE] Short visible text (${visibleTextLength} chars) — waiting extra 5s for JS render`)
        await page.waitForTimeout(5000)
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

      // Second dismissal pass — catches popups that appear after scrolling
      await dismissPopups(page)

      // Give lazy-loaded images and animations a moment to settle
      await page.waitForTimeout(1000)

      // Second pass: scroll to each lazy img individually to ensure
      // IntersectionObserver fires for every image element.
      await page.evaluate(async () => {
        const imgs = Array.from(document.querySelectorAll('img'))
        for (const img of imgs) {
          img.scrollIntoView({ block: 'center' })
          await new Promise((r) => setTimeout(r, 80))
        }
        window.scrollTo(0, 0)
      })

      // Wait for every document.images entry to report complete (JS-loaded images included)
      await page.waitForFunction(
        () => Array.from(document.images).every((img) => img.complete),
        { timeout: 10000 }
      ).catch(() => {}) // non-fatal — some images may legitimately never complete

      // Wait 5 seconds for any remaining lazy images to finish loading
      await page.waitForTimeout(5000)

      // Wait for any lazy-loaded network requests to finish
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

      onProgress?.('Taking screenshot...')

      // Full page screenshot — no height cap, capture the entire page.
      const screenshotBuffer = await page.screenshot({
        fullPage: true,
        type: 'jpeg',
        quality: 70,
      })
      const screenshotBase64 = screenshotBuffer.toString('base64')

      // Extract the full HTML after all content has loaded and rendered
      const title = await page.title()
      const rawHtml = await page.content()

      // Collect image metadata (src, rendered dimensions) before closing context.
      // Covers: <img> tags, <picture><source> srcsets, and CSS background-image on divs.
      const imageInfos: ImageInfo[] = projectId
        ? await page.evaluate((): ImageInfo[] => {
            const results: Array<{ src: string; attrSrc: string; width: number; height: number }> = []

            // ── 1. <img> elements ──────────────────────────────────────────
            for (const img of Array.from(document.querySelectorAll('img'))) {
              const el = img as HTMLImageElement
              const dataSrc = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || ''
              const src = el.currentSrc || el.src || dataSrc
              const attrSrc = el.src || dataSrc
              if (!attrSrc.startsWith('http')) continue
              const w = el.naturalWidth || parseInt(el.getAttribute('width') || '0', 10)
              const h = el.naturalHeight || parseInt(el.getAttribute('height') || '0', 10)
              results.push({ src, attrSrc, width: w, height: h })
            }

            // ── 2. <picture><source srcset="…"> ───────────────────────────
            for (const source of Array.from(document.querySelectorAll('picture source'))) {
              const el = source as HTMLSourceElement
              const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset') || ''
              if (!srcset) continue
              // Pick the first URL from the srcset descriptor list
              const firstUrl = srcset.trim().split(/[\s,]+/)[0]
              if (!firstUrl.startsWith('http')) continue
              // Inherit dimensions from sibling <img> if available
              const siblingImg = el.closest('picture')?.querySelector('img') as HTMLImageElement | null
              const w = siblingImg?.naturalWidth || 0
              const h = siblingImg?.naturalHeight || 0
              results.push({ src: firstUrl, attrSrc: firstUrl, width: w, height: h })
            }

            // ── 3. CSS background-image on block elements ──────────────────
            for (const el of Array.from(document.querySelectorAll('div, section, article, figure, span'))) {
              const style = (el as HTMLElement).style?.backgroundImage
              if (!style || !style.includes('url(')) continue
              // Extract URL from url("…") — handle quoted and unquoted forms
              const match = style.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/)
              if (!match) continue
              const url = match[1]
              const rect = (el as HTMLElement).getBoundingClientRect()
              results.push({ src: url, attrSrc: url, width: Math.round(rect.width), height: Math.round(rect.height) })
            }

            return results
          })
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

      // Replace original image URLs with R2-hosted copies.
      // For each https:// URL also try the protocol-relative variant (//...)
      // because many sites write srcset/src without the scheme.
      if (r2UrlMap.size > 0) {
        // Expand map with protocol-relative aliases before iterating
        const expanded = new Map<string, string>(r2UrlMap)
        for (const [orig, r2] of r2UrlMap) {
          if (orig.startsWith('https://')) {
            expanded.set('//' + orig.slice('https://'.length), r2)
          } else if (orig.startsWith('http://')) {
            expanded.set('//' + orig.slice('http://'.length), r2)
          }
        }

        let replacements = 0
        for (const [orig, r2] of expanded) {
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
        console.log(`[R2] HTML replacement done: ${replacements}/${expanded.size} keys checked (${r2UrlMap.size} original + protocol-relative aliases)`)
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
