import { createHash } from 'crypto'
import { uploadToR2, isR2Configured } from './r2'

function isSkippable(url: string): boolean {
  if (!url) return true
  const t = url.trim()
  return (
    t.startsWith('data:') ||
    t.startsWith('javascript:') ||
    t.startsWith('#') ||
    t.startsWith('mailto:') ||
    t.startsWith('tel:')
  )
}

function guessContentType(url: string, headers: Headers): string {
  const ct = headers.get('content-type')?.split(';')[0].trim()
  if (ct && ct !== 'application/octet-stream' && ct !== '') return ct
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
  const MAP: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    svg: 'image/svg+xml', ico: 'image/x-icon',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
    css: 'text/css', js: 'application/javascript',
  }
  return MAP[ext] ?? 'application/octet-stream'
}

function extFromType(contentType: string): string {
  const EXT: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
    'image/x-icon': 'ico', 'font/woff': 'woff', 'font/woff2': 'woff2',
    'font/ttf': 'ttf', 'text/css': 'css', 'application/javascript': 'js',
  }
  return EXT[contentType] ?? 'bin'
}

/**
 * Decode the HTML entities that browsers write into attribute values.
 * Only decodes the subset that appears in URLs: &amp; &lt; &gt; &quot; &#39;
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}

/** Collect all absolute asset URLs referenced in the HTML string. */
function collectUrls(html: string, base: URL): Set<string> {
  const urls = new Set<string>()

  const resolve = (raw: string): string | null => {
    if (!raw || isSkippable(raw)) return null
    // Decode HTML entities before resolving — HTML often encodes & as &amp;
    // in attribute values, which makes the raw string fail URL parsing or
    // not match the actual network URL.
    const decoded = decodeHtmlEntities(raw.trim())
    try { return new URL(decoded, base).href } catch { return null }
  }

  // src="..."
  for (const m of html.matchAll(/\bsrc=["']([^"']+)["']/gi)) {
    const u = resolve(m[1]); if (u) urls.add(u)
  }

  // href="..." on <link> tags only (not <a>)
  for (const m of html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
    const u = resolve(m[1]); if (u) urls.add(u)
  }

  // srcset="url [descriptor], ..."
  for (const m of html.matchAll(/\bsrcset=["']([^"']+)["']/gi)) {
    for (const part of m[1].split(',')) {
      const u = resolve(part.trim().split(/\s+/)[0]); if (u) urls.add(u)
    }
  }

  // url(...) inside <style> blocks and inline style attributes
  for (const m of html.matchAll(/url\(["']?((?!data:)[^"')]+)["']?\)/gi)) {
    const u = resolve(m[1]); if (u) urls.add(u)
  }

  return urls
}

/**
 * rehostAssets — fetch every external asset referenced in the HTML,
 * upload each to Cloudflare R2, and rewrite all matching URLs in the markup.
 */
export async function rehostAssets(
  html: string,
  baseUrl: string,
  projectId: string
): Promise<string> {
  if (!isR2Configured()) {
    console.log('[rehostAssets] R2 not configured — skipping')
    return html
  }

  const base = new URL(baseUrl)
  const assetUrls = collectUrls(html, base)
  console.log(`[rehostAssets] ${assetUrls.size} assets to fetch for project ${projectId}`)

  const urlMap = new Map<string, string>()

  await Promise.allSettled(
    [...assetUrls].map(async (assetUrl) => {
      try {
        const res = await fetch(assetUrl, { signal: AbortSignal.timeout(10000) })
        if (!res.ok) return

        const buffer = Buffer.from(await res.arrayBuffer())
        const contentType = guessContentType(assetUrl, res.headers)
        const ext = extFromType(contentType)
        const hash = createHash('md5').update(assetUrl).digest('hex').slice(0, 16)
        const key = `projects/${projectId}/assets/${hash}.${ext}`

        const r2Url = await uploadToR2(buffer, key, contentType)
        urlMap.set(assetUrl, r2Url)
      } catch {
        // asset skipped — leave original URL in HTML
      }
    })
  )

  console.log(`[rehostAssets] Uploaded ${urlMap.size}/${assetUrls.size} assets`)
  if (urlMap.size === 0) return html

  // Replace longest URLs first to avoid partial-match clobbering.
  // Also replace the &amp;-encoded form because HTML attribute values often
  // encode '&' as '&amp;', so the raw URL extracted above won't match
  // the string that actually appears in the markup.
  let result = html
  const sorted = [...urlMap.entries()].sort((a, b) => b[0].length - a[0].length)
  for (const [orig, r2] of sorted) {
    result = result.split(orig).join(r2)
    const encoded = orig.replace(/&/g, '&amp;')
    if (encoded !== orig) {
      result = result.split(encoded).join(r2)
    }
  }
  return result
}
