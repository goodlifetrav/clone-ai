/**
 * Shared header/footer utilities.
 *
 * IgualAI pages rebuilt by Gemini contain data-igualai-section attributes on
 * every section. This lets us find clean boundaries between the header region
 * (announcement-bar + nav), the main content sections, and the footer.
 */

/**
 * Extract the header region and footer from a Gemini-rebuilt HTML page.
 * Returns empty strings if the page has not been rebuilt (no section attrs).
 */
export function extractHeaderFooter(html: string): { headerHtml: string; footerHtml: string } {
  const bodyMatch = html.match(/<body[^>]*>/i)
  if (!bodyMatch) return { headerHtml: '', footerHtml: '' }
  const bodyStart = html.indexOf(bodyMatch[0]) + bodyMatch[0].length

  // The header ends just before the first NON-header content section.
  // announcement-bar and nav are part of the header region.
  const contentSectionRe = /<(?:section|div)\b[^>]*data-igualai-section="(?!announcement-bar)(?!nav)[^"]+"/i
  const contentMatch = html.search(contentSectionRe)

  let headerHtml = ''
  if (contentMatch > bodyStart) {
    const tagStart = html.lastIndexOf('<', contentMatch)
    headerHtml = html.slice(bodyStart, tagStart).trim()
  } else {
    // Fallback: just the <nav> element
    const navMatch = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/i)
    headerHtml = navMatch?.[0] ?? ''
  }

  const footerMatch = html.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/i)
  const footerHtml = footerMatch?.[0] ?? ''

  return { headerHtml, footerHtml }
}

/**
 * Replace the header and footer in a page's HTML with new ones.
 * Only operates on pages that have already been rebuilt (contain data-igualai-section).
 * Returns the original HTML unchanged if boundaries can't be found.
 */
export function replaceHeaderFooter(
  pageHtml: string,
  newHeaderHtml: string,
  newFooterHtml: string
): string {
  if (!newHeaderHtml && !newFooterHtml) return pageHtml

  // Only patch pages that have been rebuilt — raw clones have no section boundaries
  if (!pageHtml.includes('data-igualai-section')) return pageHtml

  let result = pageHtml

  // ── Replace header ───────────────────────────────────────────────────────
  if (newHeaderHtml) {
    const bodyMatch = result.match(/<body[^>]*>/i)
    if (bodyMatch) {
      const bodyStart = result.indexOf(bodyMatch[0]) + bodyMatch[0].length
      const contentSectionRe = /<(?:section|div)\b[^>]*data-igualai-section="(?!announcement-bar)(?!nav)[^"]+"/i
      const contentMatch = result.search(contentSectionRe)
      if (contentMatch > bodyStart) {
        const tagStart = result.lastIndexOf('<', contentMatch)
        if (tagStart > bodyStart) {
          result = result.slice(0, bodyStart) + '\n' + newHeaderHtml + '\n' + result.slice(tagStart)
        }
      }
    }
  }

  // ── Replace footer ───────────────────────────────────────────────────────
  if (newFooterHtml) {
    result = result.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/i, newFooterHtml)
  }

  return result
}
