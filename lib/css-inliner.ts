import { load } from 'cheerio'

/**
 * cssInliner — fetch all external stylesheets and replace <link> tags with
 * inline <style> blocks.  Processes one level of @import statements inside
 * each fetched CSS file.
 */
export async function inlineCss(html: string, baseUrl: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const $ = load(html, { xmlMode: false } as any)
  const base = new URL(baseUrl)

  const linkEls = $('link[rel="stylesheet"]').toArray()
  if (linkEls.length === 0) return html

  await Promise.all(
    linkEls.map(async (el) => {
      const href = $(el).attr('href')
      if (!href || href.startsWith('data:')) return

      let cssUrl: string
      try {
        cssUrl = new URL(href, base).href
      } catch {
        return
      }

      let css: string
      try {
        const res = await fetch(cssUrl, { signal: AbortSignal.timeout(10000) })
        if (!res.ok) return
        css = await res.text()
      } catch {
        return
      }

      // Collect @import matches before modifying the string
      // Handles: @import "x"; @import url("x"); @import url(x);
      const importRe =
        /@import\s+(?:url\s*\(\s*['"]?|['"])([^'") ]+)['"]?\s*\)?[^;]*;/g
      const imports: Array<{ full: string; href: string }> = []
      let m: RegExpExecArray | null
      while ((m = importRe.exec(css)) !== null) {
        imports.push({ full: m[0], href: m[1] })
      }

      for (const { full, href: importHref } of imports) {
        try {
          const resolved = new URL(importHref, cssUrl).href
          const importRes = await fetch(resolved, {
            signal: AbortSignal.timeout(10000),
          })
          if (importRes.ok) {
            css = css.replace(full, await importRes.text())
          }
        } catch {
          // leave the @import as-is if it fails
        }
      }

      $(el).replaceWith(`<style>${css}</style>`)
    })
  )

  return $.html()
}
