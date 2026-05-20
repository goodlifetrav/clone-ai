import { GoogleGenerativeAI } from '@google/generative-ai'

// Primary model, with a fallback for when primary is overloaded.
// gemini-2.5-pro requires thinking budget > 0 which breaks our disableThinking calls.
// gemini-2.0-flash is stable, fast, and accepts the same config with no special requirements.
const PRIMARY_MODEL = 'gemini-2.5-flash'
const FALLBACK_MODEL = 'gemini-2.0-flash'

let _client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (!_client) {
    const key = process.env.GEMINI_API_KEY
    if (!key) throw new Error('GEMINI_API_KEY is not set')
    _client = new GoogleGenerativeAI(key)
  }
  return _client
}

function isRetryable(err: unknown): boolean {
  const msg = (err as Error)?.message ?? ''
  return msg.includes('503') || msg.includes('529') || msg.includes('overloaded') || msg.includes('high demand')
}

async function withRetry<T>(fn: (model: string) => Promise<T>): Promise<T> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL]
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fn(model)
      } catch (err) {
        const isLast = model === models[models.length - 1] && attempt === 2
        if (!isRetryable(err) || isLast) throw err
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  }
  throw new Error('All Gemini models unavailable')
}

export interface GeneratedImage {
  base64: string
  mimeType: string
}

/**
 * Generate an image using Gemini 2.0 Flash image generation.
 * Returns base64-encoded image data and mime type.
 */
export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const client = getClient()
  const model = client.getGenerativeModel({
    model: 'gemini-2.0-flash-exp-image-generation',
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (model as any).generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
    },
  })

  const parts = result.response.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((p: { inlineData?: { data: string; mimeType: string } }) => p.inlineData)

  if (!imagePart?.inlineData) {
    throw new Error('Gemini did not return an image')
  }

  return {
    base64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType ?? 'image/png',
  }
}

/**
 * Generate text using Gemini with streaming.
 * Retries with fallback model if primary is overloaded.
 * onChunk receives delta text; on retry the caller's onReset is called
 * so callers can reset any accumulated state before the retry begins.
 */
export async function generateTextStreaming(
  prompt: string,
  options: {
    systemPrompt?: string
    onChunk?: (chunk: string) => void
    onReset?: () => void   // called before each retry so callers can reset buffers
    maxTokens?: number
  } = {}
): Promise<{ text: string; tokensUsed: number; inputTokens: number; outputTokens: number }> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL]

  for (let mi = 0; mi < models.length; mi++) {
    const modelName = models[mi]

    for (let attempt = 0; attempt < 3; attempt++) {
      // Reset caller's accumulated state before every attempt
      if (mi > 0 || attempt > 0) options.onReset?.()

      try {
        const client = getClient()
        const model = client.getGenerativeModel({
          model: modelName,
          ...(options.systemPrompt ? { systemInstruction: options.systemPrompt } : {}),
        })

        const result = await model.generateContentStream({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: options.maxTokens ?? 16000 },
        })

        let fullText = ''
        for await (const chunk of result.stream) {
          const text = chunk.text()
          if (text) {
            fullText += text
            options.onChunk?.(text)
          }
        }

        const response = await result.response
        const inputTokens = response.usageMetadata?.promptTokenCount ?? 0
        const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0
        const tokensUsed = inputTokens + outputTokens

        return { text: fullText, tokensUsed, inputTokens, outputTokens }
      } catch (err) {
        const isLast = mi === models.length - 1 && attempt === 2
        if (!isRetryable(err) || isLast) {
          if (mi < models.length - 1) break // try next model
          throw err
        }
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
    }
  }

  throw new Error('All Gemini models unavailable')
}

/**
 * Generate a single (non-streaming) text response from Gemini.
 * Used for short structured outputs like JSON.
 */
export async function generateText(
  prompt: string,
  options: {
    systemPrompt?: string
    maxTokens?: number
    disableThinking?: boolean
  } = {}
): Promise<{ text: string; tokensUsed: number; inputTokens: number; outputTokens: number }> {
  return withRetry(async (modelName) => {
    const client = getClient()
    const model = client.getGenerativeModel({
      model: modelName,
      ...(options.systemPrompt ? { systemInstruction: options.systemPrompt } : {}),
    })

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? 1000,
        // Disable thinking so all tokens go to actual output (not internal reasoning)
        ...(options.disableThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    })

    const text = result.response.text()
    const inputTokens = result.response.usageMetadata?.promptTokenCount ?? 0
    const outputTokens = result.response.usageMetadata?.candidatesTokenCount ?? 0
    const tokensUsed = inputTokens + outputTokens

    return { text, tokensUsed, inputTokens, outputTokens }
  })
}

/**
 * Chat-edit: asks Gemini to return a fully modified HTML document.
 * Streams the response chunk-by-chunk so the editor updates in real time.
 */
/**
 * Detect visual style signals from the cloned page HTML.
 * Returns a plain-English style description Gemini can use to match the feel.
 */
function extractStyleSignals(html: string): string {
  const signals: string[] = []

  // ── Dark vs light theme ──────────────────────────────────────────────────
  const bodyMatch = html.match(/<body[^>]*>/i)?.[0] ?? ''
  const htmlTagMatch = html.match(/<html[^>]*>/i)?.[0] ?? ''
  const headStyles = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi)?.join('') ?? ''

  // Check for explicit dark theme attributes on html/body (Framer sites use data-framer-theme="dark")
  const hasDarkAttr =
    /data-(?:framer-)?theme="dark"/i.test(bodyMatch + htmlTagMatch) ||
    /\bclass="[^"]*\bdark\b/i.test(bodyMatch + htmlTagMatch)

  // Check body's inline style for dark background
  const bodyStyleMatch = bodyMatch.match(/style="([^"]*)"/i)?.[1] ?? ''
  const hasDarkInlineStyle = /background(?:-color)?:\s*(?:#(?:0[0-9a-f]{5}|1[0-2][0-9a-f]{4})|rgb\(\s*[0-2]\d,)/i.test(bodyStyleMatch)

  const darkIndicators = [
    /class="[^"]*bg-(?:black|gray-900|gray-950|neutral-900|neutral-950|slate-900|zinc-900)/i,
    /background(?:-color)?:\s*(?:#0[0-9a-f]{5}|#1[0-9a-f]{5}|rgb\(\s*[0-2]\d,)/i,
  ]
  // looksLightBg: check many patterns including CSS custom properties (Framer/Next sites often use vars)
  const looksLightBg =
    html.match(/class="[^"]*bg-white/i) ||
    html.match(/background(?:-color)?:\s*(?:#fff(?:fff)?|white|#f[0-9a-f]{5})/i) ||
    html.match(/--(?:background|bg-color|color-bg|page-background)[^:]*:\s*(?:#fff(?:fff)?|white|#f[0-9a-f]{5})/i) ||
    html.match(/body[^{]*\{[^}]*background[^:]*:\s*(?:#fff(?:fff)?|white|#f[0-9a-f]{5})/i)

  // Scan first 10KB of styles for dark background (Framer/Next inline all CSS — dark bg rule may not be in first 2KB)
  const looksLikeDark =
    hasDarkAttr ||
    hasDarkInlineStyle ||
    darkIndicators.some((re) => re.test(bodyMatch + htmlTagMatch + headStyles.slice(0, 10000)))

  if (looksLikeDark && !looksLightBg) {
    signals.push('DARK THEME: The original site uses a dark background (near-black or very dark #0f0f0f–#1a1a2e range). Your rebuild MUST use a PURE DARK theme throughout — near-black body (#0f0f0f or #111111), all sections dark, light/white text. NO light-background sections.')
  } else {
    signals.push('LIGHT THEME: The original site uses a light/white background. Your rebuild MUST use a light theme — white or very light gray body background (#ffffff or #f8fafc), dark text.')
  }

  // ── Image density ────────────────────────────────────────────────────────
  const imgCount = (html.match(/<img\b/gi) ?? []).length
  const bgImgCount = (html.match(/background-image/gi) ?? []).length
  const totalImages = imgCount + bgImgCount

  if (totalImages >= 8) {
    signals.push('IMAGE-HEAVY: The original has many images. Use images in multiple sections — but ALWAYS in SPLIT LAYOUT (image on one side, text on the other), never as standalone full-width blocks below text.')
  } else if (totalImages >= 3) {
    signals.push('MODERATE IMAGES: The original uses some images. Include a hero image and 2-3 split-layout sections with images.')
  } else {
    signals.push('MINIMAL IMAGES: The original is text/UI focused. Use minimal images — rely on color, typography, and layout instead.')
  }

  // ── Typography scale ─────────────────────────────────────────────────────
  const hasXLType = /text-(?:7xl|8xl|9xl|\[(?:7|8|9|10|11|12|14|16|18|20)rem)/i.test(html)
  const hasLargeType = /text-(?:5xl|6xl)/i.test(html)
  const hasInlineH1Size = /font-size:\s*(?:[5-9]\d|[1-9]\d{2})px/i.test(html)

  if (hasXLType || hasInlineH1Size) {
    signals.push('MASSIVE TYPOGRAPHY: The original uses very large display text (7xl+). Use huge, bold headlines — text-7xl or larger for hero headings, text-5xl for section headings.')
  } else if (hasLargeType) {
    signals.push('LARGE TYPOGRAPHY: The original uses large display text. Use text-5xl to text-6xl for hero headings, text-3xl to text-4xl for sections.')
  } else {
    signals.push('STANDARD TYPOGRAPHY: Use text-4xl for hero, text-2xl for sections.')
  }

  // ── Layout complexity ────────────────────────────────────────────────────
  const gridColMatches = html.match(/grid-cols-(?:[3-9]|1[0-2])|columns-(?:[3-9])|md:grid-cols-[3-9]/gi) ?? []
  const sideBySlide = (html.match(/flex(?:\s+\w+)*\s+(?:items|justify)|md:flex|lg:flex/gi) ?? []).length

  if (gridColMatches.length >= 3 || sideBySlide >= 6) {
    signals.push('COMPLEX LAYOUTS: The original uses multi-column grids, side-by-side panels, and overlapping sections. Replicate this visual complexity — avoid simple stacked single-column sections.')
  } else {
    signals.push('STANDARD LAYOUTS: The original uses clean, structured layouts.')
  }

  // ── Glassmorphism / overlays ─────────────────────────────────────────────
  if (/backdrop-blur|bg-(?:white|black)\/(?:[1-9]\d)|rgba\(\d+,\s*\d+,\s*\d+,\s*0\.\d/i.test(html)) {
    signals.push('GLASS/TRANSPARENCY: The original uses glass-effect cards or semi-transparent overlays. Use backdrop-blur and bg-opacity utilities in your rebuild.')
  }

  // ── Font detection ───────────────────────────────────────────────────────
  // Extract Google Fonts URLs from the original HTML so the rebuild uses the same typeface
  const googleFontRe = /fonts\.googleapis\.com\/css[^"'>\s)]+/gi
  const googleFontUrls = [...(html.matchAll(googleFontRe) ?? [])].map(m => m[0]).slice(0, 3)

  if (googleFontUrls.length > 0) {
    // Site already uses Google Fonts — include those exact URLs
    const linkTags = googleFontUrls.map(u => `<link href="https://${u}" rel="stylesheet">`).join('\n')
    signals.push(`FONTS: The original uses Google Fonts. Add these to your rebuild <head> (in ADDITION to the required Tailwind/FA scripts):\n${linkTags}\nThen use those font families in your CSS via font-family or Tailwind's fontFamily config.`)
  } else {
    // Detect font style from CSS to recommend the closest Google Font alternative
    const hasCondensed = /condensed|narrow|compressed/i.test(html)
    const hasSerif = /\bserif\b/i.test(html.slice(0, 50000)) && !/sans-serif/i.test(html.slice(0, 1000))
    const hasMonospace = /monospace|mono\b/i.test(html)
    const customFontName = html.match(/@font-face[^}]*font-family:\s*['"]([^'"]+)['"]/i)?.[1] ?? ''

    if (hasCondensed || /helvetica|haas|grotesk|neue/i.test(customFontName)) {
      signals.push(`FONTS: The original uses a CONDENSED/COMPRESSED bold typeface (like Helvetica Neue or similar). Add to <head>: <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,400;0,600;0,700;0,800;0,900;1,700;1,800;1,900&display=swap" rel="stylesheet"> — then use font-family: 'Barlow Condensed' for ALL headings and nav text. This closely matches the original's compressed headline style.`)
    } else if (hasSerif || /playfair|georgia|times|merriweather/i.test(customFontName)) {
      signals.push(`FONTS: The original uses a SERIF typeface. Add to <head>: <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&display=swap" rel="stylesheet"> — use 'Playfair Display' for headings.`)
    } else if (hasMonospace) {
      signals.push(`FONTS: The original uses a monospace/code font. Add to <head>: <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet"> — use 'JetBrains Mono' for headings.`)
    } else {
      signals.push('FONTS: Use Inter (already included in head requirements) for all text.')
    }
  }

  return signals.join('\n')
}

/**
 * Build a compact section map of the cloned page.
 *
 * Sending the full HTML (300-500KB for complex sites) overwhelms Gemini and
 * causes incomplete responses / fallbacks. Instead we extract:
 *  1. Every heading (h1-h6) with the 400 chars of visible text that follow it
 *     → gives Gemini the actual section titles and content descriptions
 *  2. Image/video counts per section (so it knows which are image-heavy)
 *  3. A lean tag skeleton (tags + structure, no text, no compiled classes)
 *     → shows layout nesting and element counts
 *
 * This gives Gemini everything it needs to identify section count, section
 * purpose, and layout complexity — in ~20-40KB instead of 300-500KB.
 */
function buildPageBlueprint(html: string): string {
  const noiseStripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  // ── PART 1: Section map (headings + surrounding context) ─────────────────
  const sectionLines: string[] = []

  // Find nav text
  const navHtml = noiseStripped.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/i)?.[0] ?? ''
  if (navHtml) {
    const navText = navHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
    sectionLines.push(`[NAV]: ${navText}`)
  }

  // Split around every heading to capture section context
  const headingRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi
  let m: RegExpExecArray | null
  let sectionNum = 1
  while ((m = headingRegex.exec(noiseStripped)) !== null) {
    const level = parseInt(m[1])
    const headingText = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (!headingText || headingText.length < 2) continue

    // Grab the 500 chars of HTML after this heading for context
    const afterHeading = noiseStripped.slice(m.index + m[0].length, m.index + m[0].length + 500)
    const afterText = afterHeading.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)

    // Count images near this section
    const nearbyHtml = noiseStripped.slice(m.index, m.index + 2000)
    const imgCount = (nearbyHtml.match(/<img\b/gi) ?? []).length
    const hasSvg = /<svg\b/i.test(nearbyHtml)
    const hasVideo = /<video\b/i.test(nearbyHtml)
    const buttonCount = (nearbyHtml.match(/<button\b|<a\b[^>]*(?:btn|button)/gi) ?? []).length
    const listCount = (nearbyHtml.match(/<li\b/gi) ?? []).length

    const prefix = '#'.repeat(Math.min(level, 3))
    let meta = ''
    if (imgCount > 0) meta += ` [${imgCount} image${imgCount > 1 ? 's' : ''}]`
    if (hasVideo) meta += ' [video]'
    if (hasSvg) meta += ' [icons/svg]'
    if (buttonCount > 0) meta += ` [${buttonCount} button${buttonCount > 1 ? 's' : ''}]`
    if (listCount > 3) meta += ` [list: ${listCount} items]`

    sectionLines.push(`[SECTION ${sectionNum}] ${prefix} ${headingText}${meta}`)
    if (afterText) sectionLines.push(`  Context: ${afterText}`)
    sectionNum++
  }

  // Footer
  const footerHtml = noiseStripped.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/i)?.[0] ?? ''
  if (footerHtml) {
    const links = (footerHtml.match(/<a\b/gi) ?? []).length
    sectionLines.push(`[FOOTER]: multi-column, ${links} links`)
  }

  // ── PART 2: Structural skeleton (layout nesting, no text) ────────────────
  const skeleton = noiseStripped
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '<svg/>')
    .replace(/<img\b[^>]*\/?>/gi, '<img/>')
    .replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, '<video/>')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '<iframe/>')
    .replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, '<canvas/>')
    // Strip all attributes — compiled class names add noise
    .replace(/\s+[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?="[^"]*"/gi, '')
    // Replace text nodes
    .replace(/>[^<]{3,}</g, '>[…]')
    .replace(/\s+/g, ' ')
    .trim()
    // Cap skeleton at 30KB — enough to show nesting depth without overwhelming
    .slice(0, 30000)

  return `━━━ SECTION MAP (every section in order) ━━━\n${sectionLines.join('\n')}\n\n━━━ STRUCTURAL SKELETON (layout nesting reference) ━━━\n${skeleton}`
}

/**
 * Analyze each section of the cloned page and return a structured plain-English
 * description of layout patterns, image counts, and heading text.
 * This is far more useful than an HTML skeleton when the original site uses
 * compiled/minified CSS class names that Gemini cannot interpret.
 */
function describeSiteStructure(html: string): string {
  const parts: string[] = []

  const cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  // Helper: extract visible text from an HTML snippet (strip tags, collapse whitespace)
  const getText = (s: string) =>
    s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

  // ── NAV ──────────────────────────────────────────────────────────────────
  const navHtml = cleaned.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/i)?.[0] ?? ''
  if (navHtml) {
    const links = (navHtml.match(/<a\b/gi) ?? []).length
    const hasBtn = /button|btn/i.test(navHtml)
    parts.push(`• NAV: logo + ${links} links${hasBtn ? ' + CTA button' : ''}`)
  }

  // ── HERO (first major block) ─────────────────────────────────────────────
  // Grab the first large block that contains an h1 or very large text
  const heroMatch = cleaned.match(/<(?:header|section|div)\b[^>]*>[\s\S]{100,}/i)
  if (heroMatch) {
    const heroSlice = heroMatch[0].slice(0, 15000)
    const h1 = heroSlice.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ''
    const h1Text = getText(h1).slice(0, 60)
    const imgCount = (heroSlice.match(/<img\b/gi) ?? []).length
    const hasBgImg = /background-image/i.test(heroSlice.slice(0, 2000))
    const hasGrid = /grid|columns/i.test(heroSlice)

    // Detect text alignment — check for explicit center classes/styles, default to left
    const hasCenterAlign = /text-center|mx-auto|justify-center.*flex.*col|text-align:\s*center/i.test(heroSlice.slice(0, 3000))
    const alignment = hasCenterAlign ? 'CENTERED text' : 'LEFT-ALIGNED text (NOT centered — flush left, not centered on page)'

    // Detect spacious top padding (Linear-style hero has a lot of space above the headline)
    const hasSpacious = /pt-\d{2,}|py-\d{2,}|padding-top:\s*(?:[6-9]\d|[1-9]\d{2})/i.test(heroSlice.slice(0, 2000))

    // Detect announcement/badge pill (common in Linear-style heroes — small label + link to the right of subtext)
    const hasAnnouncementPill = heroSlice.length > 500 && /new\b|announcing|launch|just\s+released|→|↗/i.test(getText(heroSlice).slice(0, 200))

    let heroDesc = `HERO: full-width, ${alignment}`
    if (hasSpacious) heroDesc += ', SPACIOUS top padding (headline sits low in a tall hero)'
    if (hasBgImg) heroDesc += ', background image'
    if (h1Text) heroDesc += `, massive headline ("${h1Text}")`
    if (hasAnnouncementPill) heroDesc += ', announcement pill/badge link alongside subtext'
    if (imgCount >= 6 && hasGrid) heroDesc += `, IMAGE MOSAIC GRID (${imgCount} images in multi-column grid)`
    else if (imgCount >= 3) heroDesc += `, ${imgCount} embedded images in grid`
    else if (imgCount === 1) heroDesc += ', FULL-BLEED BACKGROUND IMAGE — text is overlaid ON TOP of the image (not below it). Use a tall dark gradient div (min-height:80vh) as the image placeholder with the headline text centered/left-aligned INSIDE it. Do NOT place a UI mockup here.'
    else if (imgCount === 2) heroDesc += ', 2 images alongside headline'
    heroDesc += ', CTA buttons'
    parts.push(`• ${heroDesc}`)
  }

  // ── INTERIOR SECTIONS ────────────────────────────────────────────────────
  // Priority 1: Shopify section divs FIRST — most reliable for Shopify sites.
  // Each shopify-section div spans exactly one page section (product grid,
  // carousel, etc.) so this avoids the nested-<section> miscount problem.
  const sectionMatches: string[] = []
  let m: RegExpExecArray | null

  // Match on EITHER id="shopify-section..." OR class="...shopify-section..."
  // Skip non-page sections: review widgets, cart drawer, search overlay, popups, modals, sidebars.
  const skipSectionRe = /id="shopify-section[^"]*(?:review|testimonial|loox|yotpo|judgeme|stamped|okendo|fera|rivyo|ali-review|cart|cart-drawer|cart-notification|search|predictive-search|modal|popup|drawer|flyout|overlay|sidebar|cookie|gdpr|age-verify|quick-view|sticky)[^"]*"/i
  const shopifyRe = /<div\b[^>]*(?:id="shopify-section[^"]*"|class="[^"]*\bshopify-section\b[^"]*")[^>]*>([\s\S]*?)(?=<div\b[^>]*(?:id="shopify-section|class="[^"]*\bshopify-section\b)|<footer\b|<\/body>|$)/gi
  while ((m = shopifyRe.exec(cleaned)) !== null) {
    const openTag = m[0].slice(0, 200)
    if (skipSectionRe.test(openTag)) continue
    // Include small sections that look like announcement bars even if < 300 chars
    const isSmallAnnouncementBar = m[0].length < 300 && /\d+%\s*off|free\s*ship|promo|sale|announce|% off/i.test(m[0])
    if (m[0].length > 300 || isSmallAnnouncementBar) sectionMatches.push(m[0])
  }

  // Priority 2: HTML5 <section> tags — but ONLY if count is reasonable.
  // Too many (>12) means nested carousel/card sections, not top-level page sections.
  // Too small (avg < 800 chars) means the same thing. Skip noisy results.
  if (sectionMatches.length < 2) {
    const secRegex = /<section\b[^>]*>([\s\S]*?)<\/section>/gi
    const tempSections: string[] = []
    while ((m = secRegex.exec(cleaned)) !== null) tempSections.push(m[0])
    const avgSize = tempSections.reduce((s, t) => s + t.length, 0) / (tempSections.length || 1)
    if (tempSections.length >= 2 && tempSections.length <= 12 && avgSize > 800) {
      sectionMatches.push(...tempSections)
    }
  }

  // Framer and many modern sites don't use <section> — detect by h2/h3 headings instead.
  // Each major content section almost always has a heading, so split around them.
  if (sectionMatches.length < 2) {
    const bodyContent = cleaned.replace(/[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*/i, '')
    const headingChunks = bodyContent.split(/(?=<h[23]\b)/i)
    for (const chunk of headingChunks) {
      if (chunk.length > 200) sectionMatches.push(chunk) // no size cap — full section content
    }
  }

  // Last resort: split by content blocks if still fewer than 3 sections
  if (sectionMatches.length < 3) {
    const bodyContent = cleaned.replace(/[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*/i, '')
    for (let i = 0; i < bodyContent.length; i += 3000) {
      const chunk = bodyContent.slice(i, i + 3000)
      if (chunk.length > 500 && /<(?:h[1-6]|p|img|button)\b/i.test(chunk)) {
        sectionMatches.push(chunk)
      }
    }
  }

  // Cap at 10 visible content sections — Shopify stores often have 20+ section divs in the DOM
  // including cart drawers, search overlays, popups, and subscription widgets that appear
  // at the end of the body. The real visible page sections always come first in document order.
  if (sectionMatches.length > 10) {
    sectionMatches.splice(10)
  }

  let secNum = 1
  let newsletterCount = 0  // cap at 1 newsletter section per page
  for (const sec of sectionMatches) {
    const imgCount = (sec.match(/<img\b/gi) ?? []).length
    const bgImgCount = (sec.match(/background-image/gi) ?? []).length
    const totalImgs = imgCount + bgImgCount
    const videoCount = (sec.match(/<video\b/gi) ?? []).length
    const h2h3Count = (sec.match(/<h[2-3]\b/gi) ?? []).length

    // Skip review-dump sections: high density of review/blockquote content, large size, and no
    // real content signals (product grid, carousel headings, or lifestyle images).
    // "long quoted strings in HTML" pattern is NOT used here — attribute values also match it.
    const hasProductSignalsQuick = /\$\d|add.{0,5}cart|shop.{0,10}now|buy.{0,5}now/i.test(sec)
    const isQuickReviewDump = !hasProductSignalsQuick
      && totalImgs < 3        // exclude image-heavy sections (lifestyle strips)
      && h2h3Count < 3        // exclude carousels (many sub-headings)
      && /\bblockquote\b|class="[^"]*\b(?:review|testimonial|yotpo|loox|stamped|okendo|spr-)\b/i.test(sec)
      && Math.round(sec.length / 400) > 8
    if (isQuickReviewDump) continue

    // Heading text
    const headingMatch = sec.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)
    const headingText = headingMatch ? getText(headingMatch[1]).slice(0, 60) : ''

    // Skip cart notification / cart drawer sections regardless of their shopify-section id format
    if (/item.{0,10}added.{0,15}cart|added to (your )?cart|your cart is|cart (notification|drawer|popup)|recently viewed/i.test(headingText)) continue
    // Also skip by section text content for sections without headings (cart drawers, age-gate, etc.)
    const secTextSnippet = sec.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)
    if (!headingText && /item added to (your )?cart|you may also like|recently viewed|age verification|enter your (birth)?date/i.test(secTextSnippet)) continue

    // Detect text alignment for this section
    const secHasCenterAlign = /text-center|mx-auto|text-align:\s*center/i.test(sec.slice(0, 1000))
    const secAlignment = secHasCenterAlign ? 'centered' : 'left-aligned'

    // Detect layout type
    // NOTE: do NOT rely on hasFlex/hasGrid for split detection — Framer/Next.js sites
    // put all layout CSS in <style> blocks which describeSiteStructure strips.
    const hasGrid = /grid/i.test(sec)
    const listItemCount = (sec.match(/<li\b/gi) ?? []).length
    const cardPatterns = (sec.match(/<(?:article|figure)\b|class="[^"]*card/gi) ?? []).length
    // isQuote: check text content only (strip tags so HTML attribute values don't trigger it)
    const secText = sec.replace(/<[^>]+>/g, ' ')
    const isQuote = /\bblockquote\b|class="[^"]*\b(?:review|testimonial)\b/i.test(sec)
      || (secText.match(/"[^"]{20,}"/g) ?? []).length >= 2
    // Logo bar: many images, minimal text — trusted-by / partner strip
    const isLogoBar = totalImgs >= 4 && sec.length < 4000 && (getText(sec).length < 150 || /trusted|partner|customer|used by|powered by/i.test(sec))
    // Announcement/promo bar: short section, no images, promotional text (discount, free shipping)
    const isAnnouncementBar = totalImgs === 0 && sec.length < 600 && /\d+%\s*off|free\s*ship|promo|sale|announce|% off/i.test(sec)
    const isCta = !isAnnouncementBar && totalImgs === 0 && sec.length < 800 && /button|btn|get.{0,10}start|sign.{0,5}up|try.{0,5}free/i.test(sec)
    // Newsletter signup: has email input — check before isQuote so newsletter sections aren't misclassified
    const isNewsletter = /type="email"|name="email"|newsletter|subscribe/i.test(sec) && !hasProductSignalsQuick
    // Product grid: multiple images + price tags + add-to-cart signals (e-commerce product collection)
    const isProductGrid = totalImgs >= 3 && hasProductSignalsQuick
    // Pricing grid: SaaS plan cards — price + plan/monthly signals but NOT an e-commerce product grid
    const isPricingGrid = !isProductGrid && /price|\$\d|\bplan\b|\bmonthly\b/i.test(sec)
    // Lifestyle photo strip: multiple images — editorial/people photos. Allow headings (e.g. "OUR CORE VALUES")
    const isLifestyleStrip = totalImgs >= 2 && totalImgs <= 8 && !isProductGrid && !isPricingGrid && h2h3Count < 3
    // Split layout: section has a heading + 1-2 images = text on one side, image/screenshot on other.
    // 1-2 images is the key signal — card grids have many small icons, split layouts have 1 large screenshot.
    const isSplit = totalImgs >= 1 && totalImgs <= 2 && headingText.length > 0 && !isPricingGrid && !isProductGrid && !isLifestyleStrip

    let layout: string
    if (isAnnouncementBar) {
      const barText = getText(sec).slice(0, 60)
      layout = `ANNOUNCEMENT BAR — thin full-width bar at top of page (above nav). Dark background, centered promotional text ("${barText}"), small font. Height ~40px.`
    } else if (isLogoBar) {
      layout = `LOGO BAR — ${totalImgs} brand logos in a horizontal row (social proof / trusted-by strip)`
    } else if (isCta) {
      layout = `CTA SECTION — centered heading, 1-2 buttons, no images`
    } else if (isProductGrid) {
      if (totalImgs >= 7) {
        // Many images = Shopify featured-collection mosaic: tight full-width product image grid, NO sidebar
        layout = `PRODUCT MOSAIC GRID — full-width 3-column grid (grid-cols-3). ${Math.min(6, totalImgs)} large square product image placeholders packed tightly into a 3×2 grid with minimal or zero gaps — edge-to-edge, spanning full container width. Each placeholder: dark gradient square with a centered thematic icon (fa-flask, fa-leaf, fa-spray-can, etc.). NO sidebar. NO product list panel on the side. Just the image grid, full width. Section has a centered uppercase heading above the grid.`
      } else {
        layout = `PRODUCT GRID — ${totalImgs} product cards in a ${Math.min(4, Math.ceil(totalImgs / 2))}-column grid. Each card: square product image placeholder, product name, price ($XX.XX), "Add to Cart" button`
      }
    } else if (isPricingGrid) {
      layout = `PRICING SECTION — 2-3 plan cards with price, features list, CTA button`
    } else if (isNewsletter) {
      // Cap at 1 newsletter section — subsequent newsletter sections are redundant and cause bloat
      newsletterCount++
      if (newsletterCount > 1) continue
      layout = `NEWSLETTER SIGNUP — INLINE LAYOUT: large bold condensed heading${headingText ? ` ("${headingText}")` : ''} on the LEFT, email input field + submit button inline on the RIGHT — all on the same row using flexbox. No stacking. Minimal, full-width section.`
    } else if (isLifestyleStrip) {
      const stripHeading = headingText ? ` heading: "${headingText}",` : ' NO heading text.'
      const hasMarquee = /marquee|ticker|data-marquee|js-marquee|overflow.{0,20}hidden.{0,100}white-space:\s*nowrap|animation.*translate/i.test(sec)
      const marqueeText = hasMarquee ? ' PRECEDED BY a full-width scrolling marquee ticker bar (infinite horizontal scroll animation) repeating short ALL-CAPS brand phrases separated by bullets (e.g. "FORGE YOUR PATH • CRAFT YOUR LEGACY • UNLEASH YOUR POTENTIAL •"). Dark background, small uppercase text.' : ''
      layout = `LIFESTYLE PHOTO STRIP —${stripHeading} ${totalImgs} full-width editorial/lifestyle photos in a horizontal row. Full viewport width. Each photo is very tall (min-height: 400px). Use tall gradient placeholder divs in brand colors with a person silhouette icon. Optional CTA button.${marqueeText}`
    } else if (totalImgs >= 3 && h2h3Count >= 3) {
      // Many headings + many images = product/fragrance carousel
      const itemCount = h2h3Count
      const firstHeading = sec.match(/<h[2-3][^>]*>([\s\S]*?)<\/h[2-3]>/i)?.[1]?.replace(/<[^>]+>/g, '').trim().slice(0, 40) ?? ''
      layout = `PRODUCT/CONTENT CAROUSEL — horizontal scroll, showing 2-3 items at once with partial overflow hint. CRITICAL: every card is FULLY DARK (bg-gray-900 or bg-[#0f0f0f]) top to bottom — NO white or light backgrounds anywhere in the card or carousel. Card structure: (1) full-width dark image placeholder with thematic icon, (2) small "COLOGNE ONLY" or category label, (3) large bold item name (first: "${firstHeading}"), (4) description paragraph, (5) PRIMARY NOTES / FRAGRANCE FAMILY / FRAGRANCE TYPE bold-label + value rows, (6) gold "SHOP [NAME]" link.`
    } else if (h2h3Count >= 3) {
      // Many headings, no images = fragrance/product list carousel (images loaded by JS)
      const itemCount = h2h3Count
      const firstHeading = sec.match(/<h[2-3][^>]*>([\s\S]*?)<\/h[2-3]>/i)?.[1]?.replace(/<[^>]+>/g, '').trim().slice(0, 40) ?? ''
      layout = `PRODUCT/CONTENT CAROUSEL — horizontal scroll, showing 2-3 items at once with partial overflow hint. CRITICAL: every card is FULLY DARK (bg-gray-900 or bg-[#0f0f0f]) top to bottom — NO white or light backgrounds. Card structure: (1) full-width dark image placeholder with thematic icon, (2) small category label, (3) large bold item name (first: "${firstHeading}"), (4) description paragraph, (5) PRIMARY NOTES / FRAGRANCE FAMILY / FRAGRANCE TYPE metadata rows, (6) gold "SHOP [NAME]" link.`
    } else if (isQuote) {
      layout = `TESTIMONIALS — ${Math.max(1, Math.round(sec.length / 400))} quote cards with author name and role`
    } else if (isSplit) {
      const side = secNum % 2 === 0 ? 'RIGHT text, LEFT image' : 'LEFT text, RIGHT image'
      layout = `SPLIT LAYOUT — 50/50 flex row: ${side}. Text side is ${secAlignment}. LARGE heading (text-5xl+), paragraph, optional button. ${totalImgs > 1 ? totalImgs + ' images' : '1 large image or UI screenshot'} on image side.`
      if (videoCount > 0) layout += ` + ${videoCount} video`
    } else if (totalImgs >= 5 || (totalImgs >= 3 && hasGrid)) {
      layout = `IMAGE GRID — ${totalImgs} images in a ${Math.ceil(totalImgs / 2)}-column mosaic or gallery grid`
    } else if ((listItemCount >= 3 || cardPatterns >= 2) && hasGrid) {
      layout = `CARD GRID — ${Math.max(listItemCount, cardPatterns, 3)} cards in a ${Math.min(4, Math.ceil(listItemCount / 2))}-column grid, ${secAlignment}. Each card: icon/image, heading, short text`
    } else if (totalImgs >= 1) {
      layout = `CONTENT SECTION with ${totalImgs} image(s), ${secAlignment} — mixed text and images`
    } else {
      // Check if this is a scrolling marquee/ticker before classifying as plain TEXT SECTION
      const bulletCount = (secText.match(/[•·|→]/g) ?? []).length
      const isMarqueeTicker = bulletCount >= 3 && totalImgs === 0 && headingText.length === 0 && sec.length < 2000
      if (isMarqueeTicker) {
        const sampleText = secText.replace(/\s+/g, ' ').trim().slice(0, 80)
        layout = `SCROLLING MARQUEE TICKER — full-width infinite horizontal scroll (CSS animation translateX). Repeating ALL-CAPS brand phrases separated by bullets/dots: "${sampleText}...". Dark background, small uppercase text, continuous loop.`
      } else {
        layout = `TEXT SECTION — ${secAlignment} heading, paragraph, optional button`
      }
    }

    // ── Post-classification filters — skip sections that are clearly widget/plugin noise ──
    // 1. Accessibility plugin sections (Shopify app that injects an accessibility widget)
    if (/accessibility|shoppers.{0,8}with.{0,8}disabilit|ada.{0,5}compli|toggle.{0,20}accessibility/i.test(headingText)) continue
    // 2. Pricing section with a long garbled heading = a UI accordion/toggle widget, not a real section
    if (layout.startsWith('PRICING') && headingText.length > 30) continue
    // 3. Empty low-signal sections (no heading, no images, small size) = spacers or hidden Shopify app widgets
    if ((layout.startsWith('TEXT SECTION') || layout.startsWith('CONTENT SECTION')) && headingText.length === 0 && totalImgs === 0 && sec.length < 1500) continue
    // 4. CONTENT SECTION with 1 image and no heading = likely blog/social widget
    if (layout.startsWith('CONTENT SECTION') && headingText.length === 0 && totalImgs <= 1) continue
    // 5. SPLIT LAYOUT with a single-word heading = brand name used as section heading (Shopify brand-story widget).
    //    Real split-layout headings are phrases ("Why Choose Us", "Built Different"). Single-word headings like
    //    "Beardbrand" are the site's own name injected by a theme section, not real page content.
    if (layout.startsWith('SPLIT LAYOUT') && headingText.length > 0 && !headingText.includes(' ')) continue

    parts.push(`• SECTION ${secNum}: ${layout}${headingText ? ` — heading: "${headingText}"` : ''}`)
    secNum++
  }

  // ── FOOTER ───────────────────────────────────────────────────────────────
  const footerHtml = cleaned.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/i)?.[0] ?? ''
  if (footerHtml) {
    const links = (footerHtml.match(/<a\b/gi) ?? []).length
    const cols = Math.min(5, Math.max(2, Math.round(links / 5)))
    parts.push(`• FOOTER: ${cols}-column link grid, logo, social icons, copyright`)
  }

  if (parts.length === 0) {
    return 'Standard multi-section landing page: nav, hero with CTA, 4-6 feature sections, footer'
  }

  const sectionCount = secNum - 1
  return `⚠️ EXACT SECTION COUNT: ${sectionCount} sections detected. You MUST output EXACTLY ${sectionCount} sections in this exact order — no more, no less. Do not invent, merge, or skip any section.\n\n${parts.join('\n')}`
}

/**
 * Derive a heading checklist directly from describeSiteStructure()'s output string.
 * This guarantees the checklist always matches the section map — no risk of carousel
 * items in the checklist disagreeing with the structure description.
 *
 * Falls back to raw h1-h3 HTML scanning when describeSiteStructure finds no headings
 * (e.g. very minimal single-page sites).
 */
function buildHeadingChecklist(siteStructure: string, html: string): string {
  // Extract ALL bullet-point lines from the structure — each represents one real section.
  // Format emitted by describeSiteStructure: "• HERO — ...", "• Section N: TYPE — ..."
  const sectionLines = siteStructure.split('\n').filter(line => /^\s*•\s+/.test(line))

  if (sectionLines.length >= 2) {
    // Build a human-readable label for each section:
    // If it has a heading, use that. Otherwise use the section type.
    const labels = sectionLines.map((line, i) => {
      const headingMatch = line.match(/—\s*heading:\s*"([^"]+)"/i)
      if (headingMatch) return `${i + 1}. "${headingMatch[1]}"`
      // Extract the section type from the bullet (e.g. "HERO", "ANNOUNCEMENT BAR", "PRODUCT GRID")
      const typeMatch = line.match(/^\s*•\s+(?:Section\s+\d+:\s*)?([\w\/\s\-]+?)(?:\s+—|\s*$)/i)
      const label = typeMatch ? typeMatch[1].trim() : `Section ${i + 1}`
      return `${i + 1}. [${label}] (no heading — this section has images/content but no text heading)`
    })

    return `REQUIRED SECTIONS — the original has EXACTLY ${sectionLines.length} sections. Output EXACTLY these ${sectionLines.length} sections in this exact order. NO MORE, NO FEWER:\n${labels.join('\n')}\n\nCRITICAL: DO NOT add testimonial sections, review sections, social proof sections, pricing/plan sections, accessibility sections, community sections, or ANY section not listed above. If a section type above has no heading, reproduce its layout (product grid, lifestyle photo strip, carousel, etc.) without inventing a new section around it.`
  }

  // Fallback: scan raw HTML for h1-h3 headings (used when structure has no section bullets)
  const cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  const getText = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const headings: string[] = []
  const seen = new Set<string>()
  const headingRegex = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi
  let m: RegExpExecArray | null
  while ((m = headingRegex.exec(cleaned)) !== null) {
    const text = getText(m[2]).slice(0, 80)
    if (text.length > 2 && !seen.has(text)) { seen.add(text); headings.push(text) }
  }
  if (headings.length === 0) return ''
  return `REQUIRED SECTIONS — these are the EXACT headings from the original HTML (${headings.length} total). You MUST output a section for EVERY heading below, in this exact order. DO NOT add any sections not in this list. No invented sections. No skipped sections:\n${headings.map((h, i) => `${i + 1}. "${h}"`).join('\n')}`
}

export async function chatWithProjectStreamingGemini(
  currentHtml: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onPartialHtml: (partialHtml: string) => void,
  uploadedImageUrls?: string[]
): Promise<{ html: string; message: string; tokensUsed: number; estimatedCost?: number }> {
  const lastUserMessage = messages[messages.length - 1]

  const hasUploadedImages = uploadedImageUrls && uploadedImageUrls.length > 0
  const userMessage = hasUploadedImages
    ? `${lastUserMessage.content}\n\nUploaded image URLs available to use: ${uploadedImageUrls!.join(', ')}`
    : lastUserMessage.content

  // Build conversation history — exclude failed/error messages to avoid confusing the model
  const historyContext = messages.slice(-7, -1)
    .filter((m) => {
      const c = m.content.toLowerCase()
      return !c.startsWith('error:') && !c.includes('could not parse') && !c.includes('could not apply') && !c.includes('could not generate')
    })
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n')

  // Analyze original HTML (before CSS strip) for theme and layout signals
  const styleSignals = extractStyleSignals(currentHtml)
  const siteStructure = describeSiteStructure(currentHtml)
  const headingChecklist = buildHeadingChecklist(siteStructure, currentHtml)
  const isDarkTheme = styleSignals.startsWith('DARK THEME')
  console.log('[brand-rebuild] siteStructure:\n', siteStructure)
  console.log('[brand-rebuild] headingChecklist:\n', headingChecklist)

  const uiMockupExample = isDarkTheme
    ? `<div class="bg-gray-900 rounded-2xl border border-gray-700 p-6">
  <div class="flex gap-2 mb-4"><div class="w-3 h-3 rounded-full bg-red-500"></div><div class="w-3 h-3 rounded-full bg-yellow-500"></div><div class="w-3 h-3 rounded-full bg-green-500"></div></div>
  <div class="space-y-3"><div class="h-4 bg-gray-700 rounded w-3/4"></div><div class="h-32 bg-gray-800 rounded-xl flex items-center justify-center text-brand-500 border border-gray-700"><i class="fas fa-chart-bar text-5xl"></i></div></div>
</div>`
    : `<div class="bg-white rounded-2xl shadow-2xl border border-gray-200 p-6">
  <div class="flex gap-2 mb-4"><div class="w-3 h-3 rounded-full bg-red-400"></div><div class="w-3 h-3 rounded-full bg-yellow-400"></div><div class="w-3 h-3 rounded-full bg-green-400"></div></div>
  <div class="space-y-3"><div class="h-4 bg-gray-100 rounded w-3/4"></div><div class="h-32 bg-gray-50 rounded-xl flex items-center justify-center text-gray-300 border border-gray-100"><i class="fas fa-chart-bar text-5xl"></i></div></div>
</div>`

  const systemPrompt = `You are an elite web designer rebuilding a cloned site for a new brand. Your #1 goal is HIGH VISUAL FIDELITY to the original site's layout — the rebuilt page must look structurally identical to the original, with only brand content, colors, and text swapped in.

REQUIRED <head> — always include exactly:
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  theme: { extend: {
    colors: { brand: { 50:'#f0f9ff', 100:'#e0f2fe', 300:'#7dd3fc', 500:'#0ea5e9', 700:'#0369a1', 900:'#0c4a6e' } },
    fontFamily: { sans:['Inter','sans-serif'] }
  }}
}
</script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

Override brand colors to match the user's palette. Keep Inter font throughout.
${isDarkTheme ? `
DARK THEME ENFORCEMENT — add this exact <style> block immediately after the Tailwind script:
<style>
  html, body { background-color: #0a0f1e !important; color: #ffffff !important; }
  /* Override any light Tailwind bg classes Gemini may accidentally use */
  .bg-white { background-color: #0f1629 !important; }
  .bg-gray-50 { background-color: #0f1629 !important; }
  .bg-gray-100 { background-color: #111827 !important; }
  .bg-gray-200 { background-color: #1f2937 !important; }
  /* Ensure text stays readable on dark */
  .text-gray-900, .text-gray-800, .text-gray-700 { color: #f9fafb !important; }
  .text-gray-600, .text-gray-500 { color: #9ca3af !important; }
</style>
Every top-level section wrapper MUST have one of: bg-[#0a0f1e] bg-[#0f1629] bg-gray-950 bg-gray-900 bg-slate-950
NO bg-white, NO bg-gray-50, NO bg-gray-100 on any section — the CSS above overrides them but avoid them anyway.` : ''}

━━━ STYLE SIGNALS (detected from original — OBEY THESE STRICTLY) ━━━
${styleSignals}

━━━ YOUR PRIMARY DIRECTIVE ━━━
The original HTML is your layout blueprint. Replicate every section EXACTLY as structured in the original:
- Same section order, same section count
- Same layout type per section (split, grid, full-width, cards, tabs, etc.)
- Same decorative elements (colored blobs, geometric shapes, floating elements — recreate with CSS/SVG in brand colors)
- Same card/row patterns (creator cards, feature tabs, product screenshot sections — keep these structures)
- Only REPLACE: colors → brand palette, text → brand copy, real photos → icon/gradient/mockup placeholders

━━━ WHAT TO REPLACE vs PRESERVE ━━━

REPLACE (swap brand-in):
- All colors → user's brand palette
- All text/copy → brand-relevant content
- External images (src="http...") → color gradient divs, icon placeholders, or UI mockups in brand colors
- Brand name, logo text → user's brand name

PRESERVE (replicate from original):
- Section layout structure (flexbox, grid columns, overlap, split)
- Decorative shapes, blobs, gradients (rebuild with CSS using brand colors)
- Card grid patterns, tab components, accordion structures
- Unique section types the original has (even if unusual)
- Overall visual density and spacing feel

━━━ PHOTO/IMAGE REPLACEMENT RULES ━━━
CRITICAL: NEVER output an empty div as an image placeholder. Every image placeholder MUST have visible content.

For every image in the original, replace it with one of these — pick based on context:
1. PRODUCT SCREENSHOT → build a UI skeleton mockup (browser chrome + sidebar + content rows). Use the example below.
2. FEATURE ILLUSTRATION → large Font Awesome icon (text-6xl) centered in a tall rounded div with a brand gradient background
3. GENERIC/DECORATIVE IMAGE → gradient div: <div class="w-full h-64 rounded-2xl bg-gradient-to-br from-[color1] to-[color2] flex items-center justify-center"><i class="fas fa-[relevant-icon] text-5xl text-white opacity-50"></i></div>
4. LOGO/ICON → inline SVG or Font Awesome icon in brand colors

ALWAYS include a Font Awesome icon inside gradient placeholders so they are never blank.
EXCEPTION: The HERO background div (full-bleed section behind the headline) must be a plain dark gradient — NO icon inside it. The hero IS the headline text. A large icon in the hero background looks like a mistake.
Never use picsum.photos or random external images.
UI mockup style for THIS site:
${uiMockupExample}

━━━ FALLBACK PATTERNS (use only when original has no equivalent section) ━━━

ICON FEATURE GRID — use for generic feature lists when original has no clear layout:
<div class="grid grid-cols-1 md:grid-cols-3 gap-12">
  <div class="space-y-3"><div class="w-10 h-10 rounded-xl ${isDarkTheme ? 'bg-gray-800 text-brand-400' : 'bg-indigo-50 text-indigo-600'} flex items-center justify-center"><i class="fas fa-bolt text-xl"></i></div><h3 class="text-lg font-semibold ${isDarkTheme ? 'text-white' : 'text-gray-900'}">Feature</h3><p class="${isDarkTheme ? 'text-gray-400' : 'text-gray-500'}">Description.</p></div>
</div>

BENTO GRID — use for comparison/highlight sections when original has no clear layout:
<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
  <div class="${isDarkTheme ? 'bg-gray-800 border border-gray-700' : 'bg-gray-900'} rounded-3xl p-10 text-white"><h3 class="text-3xl font-bold mb-4">Heading</h3><p class="text-gray-400">Text.</p></div>
  <div class="${isDarkTheme ? 'bg-gray-900 border border-gray-700' : 'bg-white border border-gray-100'} rounded-3xl p-10 space-y-4"></div>
</div>

━━━ RULES ━━━
- NO external stock photos (no picsum). Replace with gradient divs, icons, or UI mockups.
- Buttons: rounded-lg, brand-colored primary, white/gray border secondary
- Mobile responsive on every section
- Original compelling copy — no Lorem ipsum
- SHOPIFY SECTION TAGGING — add a data-igualai-section attribute to every top-level section wrapper div/section. Valid values: "announcement-bar" (thin promo bar above nav), "hero" (full hero with big heading + CTA), "product-main" (single product detail section with image, price, add-to-cart — use ONLY on product pages), "product-grid" (show products inside one collection), "collection-list" (clickable tiles each linking to a different collection page), "features" (icon feature grid), "testimonials" (quote/review cards), "lifestyle" (photo editorial strip), "newsletter" (email signup form), "content" (anything else). Example: <section data-igualai-section="hero" class="...">
- SPLIT LAYOUT structure — every split section MUST use this exact pattern, no exceptions:
  <section class="py-24 px-6 bg-[dark-or-light]">
    <div class="max-w-6xl mx-auto flex flex-col lg:flex-row items-center gap-16">
      <div class="w-full lg:w-1/2"> <!-- text side --> </div>
      <div class="w-full lg:w-1/2 overflow-hidden rounded-2xl"> <!-- mockup side --> </div>
    </div>
  </section>
  The mockup wrapper MUST have overflow:hidden so nothing bleeds outside. NEVER use absolute or relative positioning to place text over the mockup.

Output ONLY raw HTML from <!DOCTYPE html> to </html>. No markdown. No explanation.`

  const htmlForRebuild = stripCssForRebuild(currentHtml)
  const prompt = `${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}BRAND: ${userMessage}

━━━ REQUIRED SECTION CHECKLIST (from original HTML — follow exactly) ━━━
${headingChecklist}

━━━ ORIGINAL SITE SECTION STRUCTURE ━━━
${siteStructure}

━━━ ORIGINAL SITE HTML (CSS stripped — structure above is your layout guide) ━━━
${htmlForRebuild}

━━━ YOUR TASK ━━━
Rebuild this page for the brand described. NON-NEGOTIABLE RULES:
1. SECTION COUNT IS FIXED — the original has a specific number of sections listed in the structure above. Output THAT EXACT number of sections. Count them. Do not add sections. Do not remove sections.
2. ONLY the sections listed in the REQUIRED SECTION CHECKLIST above may appear. NEVER invent a testimonial section, review section, social proof section, community section, or feature grid that does not appear in the checklist. If the original has no testimonials, your output has no testimonials.
3. PRESERVE SECTION ORDER — output sections in the same order they appear in the original structure. The first section in the original must be the first section in your output.
4. EVERY image placeholder MUST have visible content (icon + gradient, UI mockup, or illustration). NEVER an empty div.
5. APPLY ${isDarkTheme ? 'DARK THEME — near-black background (#0a0f1e or #0f0f0f) throughout, ALL sections dark, light text' : 'LIGHT THEME — white/light gray background throughout'}
6. MAXIMUM 1 NEWSLETTER/EMAIL SIGNUP SECTION total. If you see multiple newsletter sections in the checklist, output only the first one and skip the rest. Never repeat email signup bars.
6. REPLACE only: colors → brand palette, text → brand copy, images → icon/gradient/mockup placeholders
7. PRESERVE: every section's layout type, alignment, spacing, and structure exactly as described above

LAYOUT RULES FOR SPECIFIC SECTION TYPES:
- HERO: headline must be HUGE — use text-6xl md:text-8xl font-black. The text IS the hero. No icon in the background div.
- CAROUSEL: each card MUST have a fixed width (max-w-xs or w-72) and flex-shrink-0 so exactly 2-3 cards are visible. Outer container: overflow-x-auto. Inner: flex gap-4. Partial overflow on last card hints at scrollability.
- SCROLLING MARQUEE TICKER: use CSS @keyframes marquee with translateX(-50%) and a duplicated list of phrases for seamless looping.
- LIFESTYLE PHOTO STRIP: heading MUST be a brand values or mission statement (e.g., "OUR CORE VALUES: [VALUE] • [VALUE] • [VALUE]" or "BUILT ON [VALUE], [VALUE], [VALUE]"). NEVER use "Join Our Community", "Join the Community", "Our Community", or any community-CTA heading — those belong in the footer, not as a mid-page section heading.

The rebuilt page must look like the SAME website redesigned for a new brand — not a generic template.
Output a complete, self-contained page from <!DOCTYPE html> to </html>.`

  let fullHtml = ''
  const { tokensUsed } = await generateTextStreaming(prompt, {
    systemPrompt,
    maxTokens: 65536,
    onReset: () => { fullHtml = '' }, // clear on retry so no partial HTML bleeds through
    onChunk: (chunk) => {
      fullHtml += chunk
      // Only stream once we've received the actual HTML start — discard any preamble Gemini added
      const htmlStart = /<!DOCTYPE html/i.test(fullHtml)
        ? fullHtml.search(/<!DOCTYPE html/i)
        : fullHtml.search(/<html/i)
      if (htmlStart >= 0) {
        onPartialHtml(fullHtml.slice(htmlStart))
      }
    },
  })

  // Extract just the HTML portion — drop preamble text and trailing code fences
  console.log('[chat] fullHtml length after stream:', fullHtml.length)
  console.log('[chat] fullHtml first 300 chars:', fullHtml.slice(0, 300))
  const htmlStart = /<!DOCTYPE html/i.test(fullHtml)
    ? fullHtml.search(/<!DOCTYPE html/i)
    : fullHtml.search(/<html/i)
  if (htmlStart > 0) fullHtml = fullHtml.slice(htmlStart)
  fullHtml = fullHtml.replace(/\n?```\s*$/, '').trim()

  if (!fullHtml || !/<html/i.test(fullHtml) || !/<\/html>/i.test(fullHtml)) {
    return {
      html: currentHtml,
      message: 'Could not generate a complete page. Please try again.',
      tokensUsed,
    }
  }

  return {
    html: fullHtml,
    message: 'Done.',
    tokensUsed,
  }
}

/**
 * Strip compiled CSS from HTML before sending to Gemini for brand rebuild.
 * Framer/Next.js sites inline megabytes of compiled CSS that pushes the
 * prompt over Gemini's 1M token limit. Gemini only needs the HTML structure
 * and text content to understand layout — not the CSS rules.
 * The rebuilt page uses Tailwind anyway so original CSS is irrelevant.
 */
function stripCssForRebuild(html: string): string {
  let stripped = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '') // remove all <style> blocks
    .replace(/\s+style="[^"]*"/gi, '')                 // remove inline style= attributes

  // Gemini 2.5 Flash hard limit is ~1M tokens (~750KB of text).
  // For very large sites (Apple, HubSpot), truncate to 600KB so we stay well under.
  // describeSiteStructure + headingChecklist already give Gemini the full layout map —
  // the raw HTML is just a supplementary reference, so truncation is safe.
  const MAX_CHARS = 600_000
  if (stripped.length > MAX_CHARS) {
    // Cut at the last complete tag boundary before the limit
    const cutPoint = stripped.lastIndexOf('>', MAX_CHARS)
    stripped = stripped.slice(0, cutPoint > 0 ? cutPoint + 1 : MAX_CHARS)
    stripped += '\n<!-- HTML truncated for token limit — section structure above is the authoritative layout guide -->'
  }

  return stripped
}

/**
 * Non-streaming brand rebuild — used by the background job pattern.
 * Waits for the full Gemini response before returning, so there are no
 * streaming timeouts or partial-HTML issues.
 */
export async function chatWithProjectGemini(
  currentHtml: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  uploadedImageUrls?: string[],
  pageType?: string,
  sharedHeaderHtml?: string,
  sharedFooterHtml?: string
): Promise<{ html: string; message: string; tokensUsed: number; estimatedCost?: number }> {
  const lastUserMessage = messages[messages.length - 1]

  const hasUploadedImages = uploadedImageUrls && uploadedImageUrls.length > 0
  const userMessage = hasUploadedImages
    ? `${lastUserMessage.content}\n\nUploaded image URLs: ${uploadedImageUrls!.join(', ')}`
    : lastUserMessage.content

  const cleanHistory = messages.slice(-7, -1).filter((m) => {
    const c = m.content.toLowerCase()
    return !c.startsWith('error:') && !c.includes('could not parse') && !c.includes('could not apply') && !c.includes('could not generate')
  })

  const historyContext = cleanHistory
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n')

  // First message = full brand rebuild. Follow-up messages = surgical edits only.
  const isFirstMessage = cleanHistory.length === 0

  if (isFirstMessage) {
    // ── FULL BRAND REBUILD ────────────────────────────────────────────────────
    // Analyze the original HTML (before CSS strip) for theme and layout signals
    const styleSignals = extractStyleSignals(currentHtml)
    const siteStructure = describeSiteStructure(currentHtml)
    const headingChecklist = buildHeadingChecklist(siteStructure, currentHtml)
    console.log('[brand-rebuild] siteStructure:\n', siteStructure)
    console.log('[brand-rebuild] headingChecklist:\n', headingChecklist)

    // Strip compiled CSS before sending — Framer/Next sites can exceed 1M tokens otherwise.
    const htmlForRebuild = stripCssForRebuild(currentHtml)
    console.log(`[gemini] rebuild — html: ${currentHtml.length} chars → ${htmlForRebuild.length} chars after CSS strip`)

    // Detect dark theme from style signals (check first signal line)
    const isDarkTheme = styleSignals.startsWith('DARK THEME')

    const uiMockupExample = isDarkTheme
      ? `<div class="bg-gray-900 rounded-2xl border border-gray-700 p-6">
  <div class="flex gap-2 mb-4"><div class="w-3 h-3 rounded-full bg-red-500"></div><div class="w-3 h-3 rounded-full bg-yellow-500"></div><div class="w-3 h-3 rounded-full bg-green-500"></div></div>
  <div class="space-y-3"><div class="h-4 bg-gray-700 rounded w-3/4"></div><div class="h-32 bg-gray-800 rounded-xl flex items-center justify-center text-gray-600 border border-gray-700"><i class="fas fa-chart-bar text-5xl text-brand-500"></i></div></div>
</div>`
      : `<div class="bg-white rounded-2xl shadow-2xl border border-gray-200 p-6">
  <div class="flex gap-2 mb-4"><div class="w-3 h-3 rounded-full bg-red-400"></div><div class="w-3 h-3 rounded-full bg-yellow-400"></div><div class="w-3 h-3 rounded-full bg-green-400"></div></div>
  <div class="space-y-3"><div class="h-4 bg-gray-100 rounded w-3/4"></div><div class="h-32 bg-gray-50 rounded-xl flex items-center justify-center text-gray-300 border border-gray-100"><i class="fas fa-chart-bar text-5xl"></i></div></div>
</div>`

    const isProductPage = pageType === 'product'
    const isCollectionPage = pageType === 'collection'

    // Shared header/footer instructions — when a homepage has already been rebuilt in this folder
    const sharedHeaderFooterInstructions = (sharedHeaderHtml || sharedFooterHtml) ? `
━━━ SHARED HEADER & FOOTER (copy these EXACTLY — do not modify) ━━━
The homepage for this brand has already been rebuilt. You MUST use the exact same header and footer so all pages in the folder look consistent.

${sharedHeaderHtml ? `HEADER — paste this verbatim as the first content after <body>:
${sharedHeaderHtml}` : ''}

${sharedFooterHtml ? `FOOTER — paste this verbatim as the last element before </body>:
${sharedFooterHtml}` : ''}

CRITICAL: Do NOT generate your own header or footer. Do NOT modify the logo, nav links, colors, or structure above. Copy them EXACTLY.
` : ''

    const collectionPageInstructions = isCollectionPage ? `
━━━ THIS IS A COLLECTION PAGE ━━━
CRITICAL: The main content is a PRODUCT GRID — not a homepage hero. Do NOT generate a hero section, brand story section, lifestyle section, or feature grid as the primary content.
- The page starts immediately with a filter/sort bar (horizontal filter options + sort dropdown)
- Below the filter bar: a multi-column product grid (3–4 columns)
- Each product card: square image placeholder (gradient + icon), product name, price, star rating
- Below the grid: pagination
- Do NOT add a large hero headline as the first section
- Do NOT add brand storytelling sections, feature grids, or lifestyle photo strips above the product grid
` : ''

    const productPageInstructions = isProductPage ? `
━━━ THIS IS A PRODUCT PAGE ━━━
CRITICAL: The main content section is a PRODUCT DETAIL SECTION — not a homepage hero.
- The product section layout: large product images on the LEFT, product title / price / add-to-cart form on the RIGHT
- Use data-igualai-section="product-main" on this section
- Include a tall product image placeholder (dark gradient div min-h-[500px], centered relevant icon), product name, price, star rating, short description, variant selector buttons (Grind Type, Size), quantity selector, and a large "Add to Cart" button (full-width, brand accent color)
- Add accordion items below (Flavor Profile, Brewing Recommendations) — collapsed by default
- Do NOT generate a full-width homepage hero with a massive headline and CTA button pair as the first section

━━━ PRODUCT PAGE SECTION LIMIT ━━━
Product pages are FOCUSED. After the product-main section, include ONLY what the original product page had:
- Product details accordion (Flavor Profile, Brew Recommendations, Shipping) — always include
- Brand lifestyle / brand story section — include if the original had one (split layout: image one side, brand copy other side)
- Related products carousel ("Others Also Bought" / "You May Also Like") — max 1 carousel
- Reviews section — ONLY if the original clearly had customer reviews
- ONE newsletter signup bar — max 1
- Footer

DO NOT ADD on product pages:
- Multiple newsletter/email signup bars (max 1 total)
- Core values icon grids
- Logo/press bars ("Featured On")
- Homepage-style full-bleed hero sections
` : ''

    const systemPrompt = `You are an elite web designer rebuilding a cloned site for a new brand. Your #1 goal is HIGH VISUAL FIDELITY to the original site's layout — the rebuilt page must look structurally identical to the original, with only brand content, colors, and text swapped in.

REQUIRED <head> — always include exactly:
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  theme: { extend: {
    colors: { brand: { 50:'#f0f9ff', 100:'#e0f2fe', 300:'#7dd3fc', 500:'#0ea5e9', 700:'#0369a1', 900:'#0c4a6e' } },
    fontFamily: { sans:['Inter','sans-serif'] }
  }}
}
</script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

Override brand colors to match the user's palette. Keep Inter font throughout.
${isDarkTheme ? `
DARK THEME ENFORCEMENT — add this exact <style> block immediately after the Tailwind script:
<style>
  html, body { background-color: #0a0f1e !important; color: #ffffff !important; }
  /* Override any light Tailwind bg classes Gemini may accidentally use */
  .bg-white { background-color: #0f1629 !important; }
  .bg-gray-50 { background-color: #0f1629 !important; }
  .bg-gray-100 { background-color: #111827 !important; }
  .bg-gray-200 { background-color: #1f2937 !important; }
  /* Ensure text stays readable on dark */
  .text-gray-900, .text-gray-800, .text-gray-700 { color: #f9fafb !important; }
  .text-gray-600, .text-gray-500 { color: #9ca3af !important; }
</style>
Every top-level section wrapper MUST have one of: bg-[#0a0f1e] bg-[#0f1629] bg-gray-950 bg-gray-900 bg-slate-950
NO bg-white, NO bg-gray-50, NO bg-gray-100 on any section — the CSS above overrides them but avoid them anyway.` : ''}
${sharedHeaderFooterInstructions}${collectionPageInstructions}${productPageInstructions}
━━━ STYLE SIGNALS (detected from original — OBEY THESE STRICTLY) ━━━
${styleSignals}

━━━ YOUR PRIMARY DIRECTIVE ━━━
The original HTML is your layout blueprint. Replicate every section EXACTLY as structured in the original:
- Same section order, same section count
- Same layout type per section (split, grid, full-width, cards, tabs, etc.)
- Same decorative elements (colored blobs, geometric shapes, floating elements — recreate these with CSS/SVG in brand colors)
- Same card/row patterns (creator cards, feature tabs, product screenshot sections — keep these structures)
- Only REPLACE: colors → brand palette, text → brand copy, real photos → icon/gradient/mockup placeholders

━━━ WHAT TO REPLACE vs PRESERVE ━━━

REPLACE (swap brand-in):
- All colors → user's brand palette
- All text/copy → brand-relevant content
- External images (src="http...") → color gradient divs, icon placeholders, or UI mockups in brand colors
- Brand name, logo text → user's brand name

PRESERVE (replicate from original):
- Section layout structure (flexbox, grid columns, overlap, split)
- Decorative shapes, blobs, gradients (rebuild with CSS using brand colors)
- Card grid patterns, tab components, accordion structures
- Unique section types the original has (even if unusual)
- Overall visual density and spacing feel

━━━ PHOTO/IMAGE REPLACEMENT RULES ━━━
CRITICAL: NEVER output an empty div as an image placeholder. Every image placeholder MUST have visible content.

For every image in the original, replace it with one of these — pick based on context:
1. PRODUCT SCREENSHOT → build a UI skeleton mockup (browser chrome + sidebar + content rows). Use the example below.
2. FEATURE ILLUSTRATION → large Font Awesome icon (text-6xl) centered in a tall rounded div with a brand gradient background
3. GENERIC/DECORATIVE IMAGE → gradient div: <div class="w-full h-64 rounded-2xl bg-gradient-to-br from-[color1] to-[color2] flex items-center justify-center"><i class="fas fa-[relevant-icon] text-5xl text-white opacity-50"></i></div>
4. LOGO/ICON → inline SVG or Font Awesome icon in brand colors

ALWAYS include a Font Awesome icon inside gradient placeholders so they are never blank.
EXCEPTION: The HERO background div (full-bleed section behind the headline) must be a plain dark gradient — NO icon inside it. The hero IS the headline text. A large icon in the hero background looks like a mistake.
Never use picsum.photos or random external images.
UI mockup style for THIS site:
${uiMockupExample}

━━━ FALLBACK PATTERNS (use only when original has no equivalent section) ━━━

ICON FEATURE GRID — 3 columns with FA icons (use for generic feature lists):
<div class="grid grid-cols-1 md:grid-cols-3 gap-12">
  <div class="space-y-3"><div class="w-10 h-10 rounded-xl ${isDarkTheme ? 'bg-gray-800 text-brand-400' : 'bg-indigo-50 text-indigo-600'} flex items-center justify-center"><i class="fas fa-bolt text-xl"></i></div><h3 class="text-lg font-semibold ${isDarkTheme ? 'text-white' : 'text-gray-900'}">Feature</h3><p class="${isDarkTheme ? 'text-gray-400' : 'text-gray-500'}">Description.</p></div>
</div>

BENTO GRID — card pair (use for comparison/highlight sections):
<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
  <div class="${isDarkTheme ? 'bg-gray-900 border border-gray-800' : 'bg-gray-900'} rounded-3xl p-10 text-white"><h3 class="text-3xl font-bold mb-4">Heading</h3><p class="text-gray-400">Text.</p></div>
  <div class="${isDarkTheme ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-100'} rounded-3xl p-10 space-y-4"></div>
</div>

━━━ RULES ━━━
- NO external stock photos (no picsum). Replace with gradient divs, icons, or UI mockups.
- Buttons: rounded-lg, brand-colored primary, white/gray border secondary
- Mobile responsive on every section
- Original compelling copy — no Lorem ipsum
- SHOPIFY SECTION TAGGING — add a data-igualai-section attribute to every top-level section wrapper div/section. Valid values: "announcement-bar" (thin promo bar above nav), "hero" (full hero with big heading + CTA), "product-main" (single product detail section with image, price, add-to-cart — use ONLY on product pages), "product-grid" (show products inside one collection), "collection-list" (clickable tiles each linking to a different collection page), "features" (icon feature grid), "testimonials" (quote/review cards), "lifestyle" (photo editorial strip), "newsletter" (email signup form), "content" (anything else). Example: <section data-igualai-section="hero" class="...">
- Output a complete, self-contained page

Output ONLY raw HTML from <!DOCTYPE html> to </html>. No markdown. No explanation.`

    // Product page minimum requirements — the PRODUCT MAIN section is always required.
    // All other sections are driven by the actual original site structure (passed below),
    // so Gemini replicates whatever layout the original had rather than a hardcoded template.
    const productPageChecklist = `PRODUCT PAGE MINIMUM REQUIREMENT:
1. PRODUCT MAIN — two-column flex row: LEFT side (55%) is a tall product image placeholder (dark gradient div, min-h-[500px], brand accent icon centered), RIGHT side (45%) has: product name (text-3xl font-bold), star rating row, price (text-2xl), short product description (2-3 sentences), variant selector buttons (e.g. Grind Type: Whole Bean / Ground; Size: 1lb / 2lb / 5lb), quantity picker, "Add to Cart" button (full-width, brand accent color), and 1-2 trust badges (free shipping, satisfaction guarantee). data-igualai-section="product-main"

For ALL sections after product-main: follow the ORIGINAL SITE SECTION STRUCTURE exactly. Replicate every section the original had with the same layout:
- Multi-column product info (e.g. Flavor Profile | Attributes/Sliders | Details | Certifications) → replicate as 4-column grid, NOT an accordion
- Brand story / lifestyle split section → replicate as two-column split
- Related products carousel → replicate the card grid
- Newsletter bar → replicate
Do NOT invent sections the original didn't have. Do NOT collapse a multi-column layout into an accordion.`

    const collectionPageChecklist = `COLLECTION PAGE STRUCTURE — output EXACTLY these sections in order:
1. FILTER & SORT BAR — full-width horizontal bar with filter dropdowns (Type, Format, Roast, Flavor, Certification) on the left and a Sort By dropdown on the right. Show product count (e.g. "53 Products"). Thin top border, compact height. data-igualai-section="content"
2. PRODUCT GRID — 3–4 column CSS grid of product cards. Each card: square image placeholder (brand gradient + thematic icon), product name (font-semibold), price, star rating row (filled stars + count). Cards have subtle border or shadow. data-igualai-section="product-grid"
3. PAGINATION — centered row of numbered page links (1 2 3 … Next →) below the grid. data-igualai-section="content"
4. NEWSLETTER SIGNUP — one full-width email capture bar: bold heading on left, email input + submit button on right, brand accent background. data-igualai-section="newsletter"

DO NOT add a hero section, brand story section, lifestyle section, or feature grid above or between these sections. The page starts with the filter bar.`

    const prompt = `BRAND: ${userMessage}

━━━ REQUIRED SECTION CHECKLIST ━━━
${isProductPage ? productPageChecklist : isCollectionPage ? collectionPageChecklist : headingChecklist}

━━━ ORIGINAL SITE SECTION STRUCTURE ━━━
${siteStructure}

━━━ ORIGINAL SITE HTML (CSS stripped — structure above is your layout guide) ━━━
${htmlForRebuild}

━━━ YOUR TASK ━━━
Rebuild this page for the brand described. NON-NEGOTIABLE RULES:
${isProductPage
  ? `1. PRODUCT MAIN must be a two-column product detail layout — NOT a homepage hero with a massive headline. The first big visual element is the product image placeholder, not a full-bleed hero banner.
2. ALL OTHER SECTIONS — match the original structure exactly. If the original has a 4-column product info section with sliders and icons, output a 4-column section. If it has a lifestyle split, output a lifestyle split. NEVER simplify or replace the original layout.
3. SECTION COUNT — match the original. Output every section from the original site structure.`
  : isCollectionPage
  ? `1. COLLECTION PAGE — the page starts with the filter/sort bar then goes straight into the product grid. Do NOT add a hero, brand story, lifestyle strip, or feature grid.
2. PRODUCT GRID must use a 3–4 column CSS grid. Each card must have an image placeholder, product name, price, and star rating. No empty cards.
3. SECTION COUNT — output exactly the 4 sections in the checklist (filter bar, product grid, pagination, newsletter).`
  : `1. SECTION COUNT IS FIXED — the original has a specific number of sections listed in the structure above. Output THAT EXACT number of sections. Count them. Do not add sections. Do not remove sections.
2. ONLY the sections listed in the REQUIRED SECTION CHECKLIST above may appear. NEVER invent a testimonial section, review section, social proof section, community section, or feature grid that does not appear in the checklist. If the original has no testimonials, your output has no testimonials.`}
${(isProductPage || isCollectionPage) ? '4.' : '3.'} PRESERVE SECTION ORDER — output sections in the same order they appear in the original.
${(isProductPage || isCollectionPage) ? '5.' : '4.'} EVERY image placeholder MUST have visible content (icon + gradient, UI mockup, or illustration). NEVER an empty div.
${(isProductPage || isCollectionPage) ? '6.' : '5.'} APPLY ${isDarkTheme ? 'DARK THEME — near-black background (#0a0f1e or #0f0f0f) throughout, ALL sections dark, light text' : 'LIGHT THEME — white/light gray background throughout'}
${(isProductPage || isCollectionPage) ? '7.' : '6.'} MAXIMUM 1 NEWSLETTER/EMAIL SIGNUP SECTION total. Never repeat email signup bars.
${(isProductPage || isCollectionPage) ? '8.' : '7.'} REPLACE only: colors → brand palette, text → brand copy, images → icon/gradient/mockup placeholders
${(isProductPage || isCollectionPage) ? '9.' : '8.'} PRESERVE: every section's layout type, alignment, spacing, and structure exactly as described above

LAYOUT RULES FOR SPECIFIC SECTION TYPES:
${isProductPage ? `- PRODUCT MAIN: Two-column flex layout (flex-col lg:flex-row). LEFT: tall product image placeholder (gradient div, min-h-[500px], rounded-2xl, centered thematic icon). RIGHT: product title (text-3xl font-bold), price, short description, variant selector buttons, qty picker, full-width "Add to Cart" button (brand accent). data-igualai-section="product-main". DO NOT make this a homepage hero.
- MULTI-COLUMN PRODUCT INFO: If the original has columns for Flavor Profile, Attributes (with visual sliders), Details text, and Certification icons — recreate as a CSS grid (grid-cols-4) with the same column content. Visual sliders: styled range inputs or custom div bars with brand accent color. Certification icons: Font Awesome or SVG icons with bold labels. data-igualai-section="content"` : isCollectionPage ? `- FILTER BAR: flex row, justify-between, py-3 px-4, border-b. Left side: label "FILTER:" + filter buttons (Type, Format, Roast, Flavor, Certification) each as a small pill/dropdown. Right side: "SORT BY: Featured" dropdown + product count text.
- PRODUCT GRID: CSS grid, grid-cols-2 md:grid-cols-3 lg:grid-cols-4, gap-6. Each card: square image placeholder (aspect-square, brand gradient + centered FA icon), product name (text-sm font-semibold mt-2), price (text-sm), star rating (filled FA stars + review count). No card borders needed — spacing provides separation.` : `- HERO: headline must be HUGE — use text-6xl md:text-8xl font-black. The text IS the hero. No icon in the background div.`}
- CAROUSEL: each card MUST have a fixed width (max-w-xs or w-72) and flex-shrink-0 so exactly 2-3 cards are visible. Outer container: overflow-x-auto. Inner: flex gap-4.
- SCROLLING MARQUEE TICKER: use CSS @keyframes marquee with translateX(-50%) and a duplicated list of phrases for seamless looping.
- LIFESTYLE PHOTO STRIP: heading MUST be a brand values or mission statement. NEVER "Join Our Community".

The rebuilt page must look like the SAME website redesigned for a new brand — not a generic template.
Output a complete, self-contained page from <!DOCTYPE html> to </html>.`

    const { text: fullHtml, tokensUsed, inputTokens, outputTokens } = await generateText(prompt, { systemPrompt, maxTokens: 65536, disableThinking: true })
    // Note: full HTML is sent — input tokens will be large (350k+ for complex sites)
    const cost = geminiCost(inputTokens ?? 0, outputTokens ?? 0)
    console.log(`[gemini] rebuild — input: ${inputTokens} tokens, output: ${outputTokens} tokens, cost: $${cost.toFixed(4)}`)

    const htmlStart = /<!DOCTYPE html/i.test(fullHtml)
      ? fullHtml.search(/<!DOCTYPE html/i)
      : fullHtml.search(/<html/i)

    const cleaned = htmlStart >= 0
      ? fullHtml.slice(htmlStart).replace(/\n?```\s*$/, '').trim()
      : fullHtml.replace(/\n?```\s*$/, '').trim()

    if (!cleaned || !/<html/i.test(cleaned) || !/<\/html>/i.test(cleaned)) {
      return { html: currentHtml, message: 'Could not generate a complete page. Please try again.', tokensUsed, estimatedCost: cost }
    }

    return { html: cleaned, message: 'Done.', tokensUsed, estimatedCost: cost }

  } else {
    // ── SURGICAL EDIT ─────────────────────────────────────────────────────────

    // Extract the brand name from the current HTML so we can anchor it explicitly in the prompt.
    // Check <title>, nav logo text, and h1 — take the shortest plausible name.
    const titleText = currentHtml.match(/<title[^>]*>([^<]{1,60})<\/title>/i)?.[1]?.split(/[|–\-·]/)[0]?.trim() ?? ''
    const h1Text = currentHtml.match(/<h1[^>]*>([^<]{1,60})<\/h1>/i)?.[1]?.trim() ?? ''
    const brandName = (titleText.length > 0 && titleText.length <= 30) ? titleText
      : (h1Text.length > 0 && h1Text.length <= 30) ? h1Text
      : titleText.slice(0, 30) || 'the current brand'

    // Detect if this is a color change request so we can add specific color-swap instructions
    const isColorChange = /change.*color|color.*change|swap.*color|color.*swap|replace.*color|color.*to\s+#/i.test(userMessage)

    // Detect if the user explicitly wants to rename the brand (skip name-protection rules if so)
    const isIntentionalRename = /(?:change|rename|update|set|make)[\s\S]{0,30}(?:brand|company|site|logo|nav)\s*name|brand\s*name[\s\S]{0,20}(?:to|=)\s*["']?\w/i.test(userMessage)

    const systemPrompt = `You are a precise HTML editor. The user wants to make a specific, targeted change to an existing webpage.

${isIntentionalRename
  ? `THE USER WANTS TO RENAME THE BRAND. Apply the brand name change everywhere it appears: nav logo, <title>, headings, footer copyright, and any other brand name references.`
  : `THE BRAND NAME IS: "${brandName}"
DO NOT change this brand name or any other text/copy under any circumstances.`}

CRITICAL RULES:
- Make ONLY the change the user explicitly requests — nothing else
${isIntentionalRename ? '' : `- NEVER change the brand name, company name, logo text, headings, body copy, or ANY text content
- NEVER invent a new brand name or rewrite content — every word in the HTML is sacred`}
- Do NOT change fonts, layout, or anything not mentioned by the user
- Do NOT "improve", "clean up", or "modernize" anything
- Preserve every class, style, attribute, and element exactly as-is except the one thing being changed
- If the user says "change X to Y", change ONLY X
${isColorChange ? `
COLOR CHANGE INSTRUCTIONS — for color changes you MUST do a COMPLETE global replacement:
- Replace EVERY Tailwind color class: text-*, bg-*, border-*, ring-*, from-*, to-*, via-*, fill-*, stroke-*
- Replace EVERY hex value in style attributes and <style> blocks
- Replace EVERY rgb()/rgba() color value
- Replace color names in the tailwind.config colors section
- Scan the ENTIRE document top to bottom — do not stop after the first few matches
- A partial color change is a failure — every single instance must be updated` : ''}

Output ONLY the complete raw HTML from <!DOCTYPE html> to </html>. No markdown. No explanation.`

    const prompt = `${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}CURRENT HTML:
${currentHtml}

USER REQUEST: ${userMessage}

REMINDER: The brand name is "${brandName}". Do not change it or any other text. Apply ONLY the requested change and return the complete modified page.`

    const { text: fullHtml, tokensUsed, inputTokens, outputTokens } = await generateText(prompt, { systemPrompt, maxTokens: 65536 })
    const cost = geminiCost(inputTokens ?? 0, outputTokens ?? 0)
    console.log(`[gemini] edit — input: ${inputTokens} tokens, output: ${outputTokens} tokens, cost: $${cost.toFixed(4)}`)

    const htmlStart = /<!DOCTYPE html/i.test(fullHtml)
      ? fullHtml.search(/<!DOCTYPE html/i)
      : fullHtml.search(/<html/i)

    let cleaned = htmlStart >= 0
      ? fullHtml.slice(htmlStart).replace(/\n?```\s*$/, '').trim()
      : fullHtml.replace(/\n?```\s*$/, '').trim()

    if (!cleaned || !/<html/i.test(cleaned) || !/<\/html>/i.test(cleaned)) {
      return { html: currentHtml, message: 'Could not apply the change. Please try again.', tokensUsed, estimatedCost: cost }
    }

    // Guard: if Gemini renamed the brand, restore every occurrence.
    // Skip this guard if the user explicitly asked to change the brand/company name.
    if (!isIntentionalRename && brandName && brandName !== 'the current brand') {
      const brandRe = new RegExp(brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      const originalCount = (currentHtml.match(brandRe) ?? []).length
      const outputCount = (cleaned.match(brandRe) ?? []).length

      if (outputCount < originalCount) {
        // Find what Gemini renamed it to — check title, h1, and nav text
        const candidates: string[] = []
        const newTitle = cleaned.match(/<title[^>]*>([^<]{1,60})<\/title>/i)?.[1]?.split(/[|–\-·]/)[0]?.trim() ?? ''
        if (newTitle && newTitle !== brandName) candidates.push(newTitle)

        const newH1 = cleaned.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim().slice(0, 30) ?? ''
        if (newH1 && newH1 !== brandName && newH1.length <= 30 && /^[A-Z]/i.test(newH1)) candidates.push(newH1)

        // Also scan nav for a short capitalized word/phrase that replaced the brand name
        const navHtml = cleaned.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/i)?.[0] ?? ''
        const navLogoText = navHtml.match(/class="[^"]*(?:logo|brand|site-name)[^"]*"[^>]*>([^<]{1,30})</i)?.[1]?.trim() ?? ''
        if (navLogoText && navLogoText !== brandName && navLogoText.length <= 30) candidates.push(navLogoText)

        for (const candidate of candidates) {
          if (!candidate || candidate === brandName) continue
          const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const replaced = cleaned.replace(new RegExp(escaped, 'gi'), brandName)
          if (replaced !== cleaned) {
            cleaned = replaced
            console.log(`[gemini] edit — brand name drift ("${candidate}" → "${brandName}"), restored`)
            break
          }
        }
      }
    }

    return { html: cleaned, message: 'Done.', tokensUsed, estimatedCost: cost }
  }
}

/**
 * Calculate estimated Gemini API cost in USD.
 * Pricing (Gemini 2.5 Flash, prompts ≤200K tokens):
 *   Input:  $0.15 / 1M tokens
 *   Output: $0.60 / 1M tokens
 */
export function geminiCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 0.15 + outputTokens * 0.60) / 1_000_000
}

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY
}
