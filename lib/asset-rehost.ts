import { createHash } from 'crypto'
import { uploadToR2, isR2Configured } from './r2'

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'])

/**
 * rehostImages — fetch every <img src> URL in the HTML, upload each to R2,
 * and rewrite all matching URLs in the markup.
 */
export async function rehostImages(html: string, projectId: string): Promise<string> {
  if (!isR2Configured()) return html

  try {
    // Collect unique img src URLs
    const seen = new Set<string>()
    const imgSrcRe = /<img\b[^>]*\bsrc=(["'])([^"']+)\1/gi
    let m: RegExpExecArray | null
    while ((m = imgSrcRe.exec(html)) !== null) {
      const url = m[2].trim()
      if (url) seen.add(url)
    }

    // Deduplicate, cap at 50
    const urls = [...seen].slice(0, 50)

    const urlMap = new Map<string, string>()

    await Promise.allSettled(
      urls.map(async (rawUrl) => {
        try {
          if (rawUrl.startsWith('data:')) return
          if (rawUrl.includes('r2.dev')) return

          // Resolve protocol-relative
          const url = rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl

          // Check extension (ignore query params)
          const pathname = url.split('?')[0]
          const ext = pathname.split('.').pop()?.toLowerCase() ?? ''
          if (!IMAGE_EXTS.has(ext)) return

          const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
          if (!res.ok) return

          const buffer = Buffer.from(await res.arrayBuffer())
          const hash = createHash('md5').update(url).digest('hex')
          const key = `projects/${projectId}/images/${hash}.${ext}`
          const r2Url = await uploadToR2(buffer, key, `image/${ext === 'jpg' ? 'jpeg' : ext}`)
          urlMap.set(rawUrl, r2Url)
        } catch {
          // skip this image
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
    const decoded = decodeEntities(raw.trim())
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
  result = result.replace(/\bsrcset=(["'])([^"']+)\1/gi, (match, q, val) => {
    const parts = val.split(',').map((part: string) => {
      const trimmed = part.trim()
      const spaceIdx = trimmed.search(/\s/)
      const urlPart = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
      const descriptor = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx)
      const abs = resolveUrl(urlPart)
      if (!abs || abs === decodeEntities(urlPart.trim())) return part
      return abs + descriptor
    })
    return `srcset=${q}${parts.join(',')}${q}`
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
