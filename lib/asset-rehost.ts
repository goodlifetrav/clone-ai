import { createHash } from 'crypto'
import { uploadToR2, isR2Configured } from './r2'

const NON_IMAGE_EXTS = new Set(['css', 'js', 'woff', 'woff2', 'ttf', 'eot', 'svg'])

/**
 * Split a srcset value into individual `URL DESCRIPTOR` entries.
 *
 * srcset entries are comma-separated, BUT modern CDN URLs frequently contain
 * commas inside the path itself (Cloudinary transforms, HelloFresh, Imgix etc.):
 *   https://media.hellofresh.com/w_96,q_100,f_auto/logo.png 1x
 * Naive `.split(',')` corrupts the URL into multiple bogus entries.
 *
 * Strategy: split only at commas that are followed by whitespace AND a token
 * starting with a URL signature (http://, https://, //, /, data:). Anything
 * else is a comma inside a URL path or query and must stay.
 */
export function splitSrcset(srcset: string): string[] {
  return srcset
    .split(/\s*,\s*(?=https?:\/\/|\/\/|\/[^,\s]|data:)/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

const FONT_EXTS = new Set(['woff', 'woff2', 'ttf', 'eot', 'otf'])

const FONT_CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'application/vnd.ms-fontobject': 'eot',
  'application/x-font-woff': 'woff',
  'application/font-woff2': 'woff2',
  'application/font-sfnt': 'ttf',
  'application/octet-stream': '', // use URL extension as fallback
}

/**
 * rehostFonts — find every font URL (@font-face src url()) in the HTML,
 * upload each to R2, and rewrite all matching URLs in the markup.
 * This is a fallback for fonts missed by Playwright's real-time interception
 * (e.g. fonts inlined from CSS after the Playwright session closes).
 */
export async function rehostFonts(html: string, projectId: string): Promise<string> {
  if (!isR2Configured()) return html

  try {
    const seen = new Set<string>()
    let m: RegExpExecArray | null

    // Collect URLs with font extensions from url() references in <style> blocks and inline styles
    const cssUrlRe = /url\(\s*["']?((?!data:)[^"')]+)["']?\s*\)/gi
    while ((m = cssUrlRe.exec(html)) !== null) {
      const url = m[1].trim()
      if (!url || url.startsWith('data:')) continue
      const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
      if (FONT_EXTS.has(ext)) seen.add(url)
    }

    const urls = [...seen]
    if (urls.length === 0) return html
    console.log(`[rehostFonts] Found ${urls.length} font URLs to process`)

    const urlMap = new Map<string, string>()

    await Promise.allSettled(
      urls.map(async (rawUrl) => {
        try {
          if (rawUrl.includes('r2.dev')) return
          const url = rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl
          if (!url.startsWith('http://') && !url.startsWith('https://')) return

          const res = await fetch(url, {
            signal: AbortSignal.timeout(8000),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': '*/*',
            },
          })
          if (!res.ok) return

          const contentType = res.headers.get('content-type')?.split(';')[0].trim() ?? ''
          const urlExt = url.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
          const ext = FONT_CONTENT_TYPE_TO_EXT[contentType] ?? (FONT_EXTS.has(urlExt) ? urlExt : null)
          if (!ext) {
            console.log(`[rehostFonts] Skipped (unrecognized type): ${url} - ${contentType}`)
            return
          }

          const buffer = Buffer.from(await res.arrayBuffer())
          const hash = createHash('md5').update(url).digest('hex')
          const key = `projects/${projectId}/fonts/${hash}.${ext}`
          const finalContentType = contentType || `font/${ext}`
          const r2Url = await uploadToR2(buffer, key, finalContentType)
          urlMap.set(rawUrl, r2Url)
          console.log(`[rehostFonts] Uploaded: ${url} -> ${r2Url}`)
        } catch (err) {
          console.log(`[rehostFonts] Skipped (error): ${rawUrl} - ${err}`)
        }
      })
    )

    if (urlMap.size === 0) return html

    let result = html
    const sorted = [...urlMap.entries()].sort((a, b) => b[0].length - a[0].length)
    for (const [orig, r2] of sorted) {
      result = result.split(orig).join(r2)
      const encoded = orig.replace(/&/g, '&amp;')
      if (encoded !== orig) result = result.split(encoded).join(r2)
    }
    return result
  } catch {
    return html
  }
}

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

/**
 * rehostImages — fetch every <img src> URL in the HTML, upload each to R2,
 * and rewrite all matching URLs in the markup.
 */
export async function rehostImages(html: string, projectId: string): Promise<string> {
  if (!isR2Configured()) return html

  try {
    // Collect unique image URLs from all sources
    const seen = new Set<string>()
    let m: RegExpExecArray | null

    // 1. <img src="...">
    const imgSrcRe = /<img\b[^>]*\bsrc=(["'])([^"']+)\1/gi
    while ((m = imgSrcRe.exec(html)) !== null) {
      const url = m[2].trim()
      if (url && !url.startsWith('data:')) seen.add(url)
    }

    // 2. srcset="url [desc], url2 [desc]" — both <img srcset> and <source srcset>
    //    Use splitSrcset to handle Cloudinary-style URLs with commas in the path.
    const srcsetRe = /\bsrcset=(["'])([^"']+)\1/gi
    while ((m = srcsetRe.exec(html)) !== null) {
      splitSrcset(m[2]).forEach(part => {
        const url = part.split(/\s+/)[0]
        if (url && !url.startsWith('data:')) seen.add(url)
      })
    }

    // 3. CSS background-image: url(...) in style attributes and <style> blocks
    const cssUrlRe = /url\(\s*["']?((?!data:)[^"')]+)["']?\s*\)/gi
    while ((m = cssUrlRe.exec(html)) !== null) {
      const url = m[1].trim()
      if (url && !url.startsWith('data:')) seen.add(url)
    }

    // Deduplicate, cap at 150
    const urls = [...seen].slice(0, 150)
    console.log(`[rehostImages] Found ${urls.length} image URLs to process`)

    const urlMap = new Map<string, string>()

    await Promise.allSettled(
      urls.map(async (rawUrl) => {
        try {
          if (rawUrl.startsWith('data:')) return
          if (rawUrl.includes('r2.dev')) return

          // Resolve protocol-relative
          const url = rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl

          // Skip known non-image extensions
          const pathname = url.split('?')[0]
          const urlExt = pathname.split('.').pop()?.toLowerCase() ?? ''
          if (NON_IMAGE_EXTS.has(urlExt)) return

          console.log(`[rehostImages] Processing: ${url}`)
          const res = await fetch(url, {
            signal: AbortSignal.timeout(8000),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': url,
              'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            },
          })
          if (!res.ok) return

          // Verify Content-Type is an image
          const contentType = res.headers.get('content-type')?.split(';')[0].trim() ?? ''
          if (!contentType.startsWith('image/')) {
            console.log(`[rehostImages] Skipped (non-image content-type): ${url} - ${contentType}`)
            return
          }

          const ext = CONTENT_TYPE_TO_EXT[contentType] ?? 'jpg'
          const buffer = Buffer.from(await res.arrayBuffer())
          const hash = createHash('md5').update(url).digest('hex')
          const key = `projects/${projectId}/images/${hash}.${ext}`
          const r2Url = await uploadToR2(buffer, key, contentType)
          urlMap.set(rawUrl, r2Url)
          console.log(`[rehostImages] Uploaded: ${url} -> ${r2Url}`)
        } catch (err) {
          console.log(`[rehostImages] Skipped (fetch failed): ${rawUrl} - ${err}`)
        }
      })
    )

    if (urlMap.size === 0) return html

    // Replace longest URLs first to avoid partial-match clobbering
    let result = html
    const sorted = [...urlMap.entries()].sort((a, b) => b[0].length - a[0].length)
    for (const [orig, r2] of sorted) {
      result = result.split(orig).join(r2)
      const encoded = orig.replace(/&/g, '&amp;')
      if (encoded !== orig) result = result.split(encoded).join(r2)
    }
    return result
  } catch {
    return html
  }
}

/**
 * makeUrlsAbsolute — rewrite all relative asset URLs in HTML to absolute URLs.
 * Pure string replacement — no fetching, no uploading, no external dependencies.
 */
export function makeUrlsAbsolute(html: string, baseUrl: string): string {
  const base = new URL(baseUrl)
  const origin = base.origin // e.g. "https://example.com"
  // Base path directory (everything up to and including the last slash)
  const basePath = base.pathname.includes('/')
    ? base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1)
    : '/'

  function decodeEntities(s: string): string {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
  }

  function resolveUrl(raw: string): string | null {
    if (!raw) return null
    let decoded = decodeEntities(raw.trim())
    // Strip surrounding quotes that arise from Chromium serializing
    // url("...") in inline styles as url(&quot;...&quot;) in HTML attributes.
    // Without this, &quot;https://example.com/img.jpg&quot; decodes to
    // "https://..." which looks like a relative path and gets incorrectly
    // resolved against the base URL, corrupting the URL entirely.
    if (decoded.length >= 2 && decoded[0] === decoded[decoded.length - 1] &&
        (decoded[0] === '"' || decoded[0] === "'")) {
      decoded = decoded.slice(1, -1)
    }
    // Special schemes — leave as-is
    if (
      decoded.startsWith('data:') ||
      decoded.startsWith('javascript:') ||
      decoded.startsWith('#') ||
      decoded.startsWith('mailto:') ||
      decoded.startsWith('tel:')
    ) {
      return null // signal: do not replace
    }
    // Already absolute
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      return decoded
    }
    // Protocol-relative
    if (decoded.startsWith('//')) {
      return 'https:' + decoded
    }
    // Root-relative
    if (decoded.startsWith('/')) {
      return origin + decoded
    }
    // Relative path (./  ../  or bare)
    try {
      return new URL(decoded, origin + basePath).href
    } catch {
      return null
    }
  }

  // Replace a URL value in HTML, handling both literal & and &amp; encoded forms.
  function replaceAll(source: string, from: string, to: string): string {
    let result = source.split(from).join(to)
    const encoded = from.replace(/&/g, '&amp;')
    if (encoded !== from) {
      result = result.split(encoded).join(to)
    }
    return result
  }

  let result = html

  // ── src="..." ────────────────────────────────────────────────────────────
  result = result.replace(/\bsrc=(["'])([^"']+)\1/gi, (match, q, val) => {
    const abs = resolveUrl(val)
    if (!abs || abs === decodeEntities(val.trim())) return match
    return `src=${q}${abs}${q}`
  })

  // ── href="..." on <link> tags only ───────────────────────────────────────
  result = result.replace(
    /(<link\b[^>]*\bhref=)(["'])([^"']+)\2([^>]*>)/gi,
    (match, pre, q, val, post) => {
      const abs = resolveUrl(val)
      if (!abs || abs === decodeEntities(val.trim())) return match
      return `${pre}${q}${abs}${q}${post}`
    }
  )

  // ── srcset="url [descriptor], ..." ───────────────────────────────────────
  // CRITICAL: srcset entries may contain commas inside the URL (Cloudinary,
  // HelloFresh, Imgix). Use splitSrcset which splits only at commas between
  // entries (comma + space + URL signature), preserving in-URL commas.
  result = result.replace(/\bsrcset=(["'])([^"']+)\1/gi, (match, q, val) => {
    const parts = splitSrcset(val).map((trimmed) => {
      const spaceIdx = trimmed.search(/\s/)
      const urlPart = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
      const descriptor = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx)
      const abs = resolveUrl(urlPart)
      if (!abs || abs === decodeEntities(urlPart.trim())) return trimmed
      return abs + descriptor
    })
    return `srcset=${q}${parts.join(', ')}${q}`
  })

  // ── url(...) in <style> blocks and inline style attributes ───────────────
  result = result.replace(
    /url\(\s*(["']?)((?!data:)[^"')]+)\1\s*\)/gi,
    (match, q, val) => {
      const abs = resolveUrl(val)
      if (!abs || abs === decodeEntities(val.trim())) return match
      return `url(${q}${abs}${q})`
    }
  )

  return result
}
