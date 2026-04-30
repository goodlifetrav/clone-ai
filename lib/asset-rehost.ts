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
