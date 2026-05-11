import { GoogleGenerativeAI } from '@google/generative-ai'

// Primary model, with a fallback for when primary is overloaded
const PRIMARY_MODEL = 'gemini-2.5-flash'
const FALLBACK_MODEL = 'gemini-2.5-pro'

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
    model: 'gemini-2.0-flash-preview-image-generation',
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
  // Only use dark indicator matches from the body/html tags and head styles (not full doc — compiled CSS has dark vars for dark-mode support even on light sites)
  const looksLikeDark = darkIndicators.some((re) => re.test(bodyMatch + htmlTagMatch + headStyles.slice(0, 2000)))

  if (looksLikeDark && !looksLightBg) {
    signals.push('DARK THEME: The original site uses a dark background (near-black or very dark). Your rebuild MUST use a dark theme — dark body/sections, light text.')
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

    let heroDesc = `HERO: full-width`
    if (hasBgImg) heroDesc += ', background image'
    if (h1Text) heroDesc += `, large heading ("${h1Text}")`
    if (imgCount >= 6 && hasGrid) heroDesc += `, IMAGE MOSAIC GRID (${imgCount} images in multi-column grid)`
    else if (imgCount >= 3) heroDesc += `, ${imgCount} embedded images in grid`
    else if (imgCount > 0) heroDesc += `, ${imgCount} image(s)`
    heroDesc += ', CTA buttons'
    parts.push(`• ${heroDesc}`)
  }

  // ── INTERIOR SECTIONS ────────────────────────────────────────────────────
  // Match <section> tags; fall back to large top-level divs if no <section> tags found
  const sectionMatches: string[] = []
  const secRegex = /<section\b[^>]*>([\s\S]*?)<\/section>/gi
  let m: RegExpExecArray | null
  while ((m = secRegex.exec(cleaned)) !== null) sectionMatches.push(m[0])

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

  // No section count cap — build every single section no matter how many
  let secNum = 1
  for (const sec of sectionMatches) {
    const imgCount = (sec.match(/<img\b/gi) ?? []).length
    const bgImgCount = (sec.match(/background-image/gi) ?? []).length
    const totalImgs = imgCount + bgImgCount
    const videoCount = (sec.match(/<video\b/gi) ?? []).length

    // Heading text
    const headingMatch = sec.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)
    const headingText = headingMatch ? getText(headingMatch[1]).slice(0, 60) : ''

    // Detect layout type
    const hasFlex = /flex/i.test(sec)
    const hasGrid = /grid/i.test(sec)
    const listItemCount = (sec.match(/<li\b/gi) ?? []).length
    const cardPatterns = (sec.match(/<(?:article|figure)\b|class="[^"]*card/gi) ?? []).length
    const isQuote = /blockquote|testimonial|review|"[^"]{20,}"/i.test(sec)
    const isLogoBar = totalImgs >= 4 && sec.length < 2000
    const isCta = totalImgs === 0 && sec.length < 800 && /button|btn|get.{0,10}start|sign.{0,5}up|try.{0,5}free/i.test(sec)
    const isPricingGrid = /price|\$\d|\bplan\b|\bmonthly\b/i.test(sec)
    const isSplit = hasFlex && totalImgs >= 1

    let layout: string
    if (isLogoBar) {
      layout = `LOGO BAR — ${totalImgs} brand logos in a horizontal row (social proof / trusted-by strip)`
    } else if (isCta) {
      layout = `CTA SECTION — centered heading, 1-2 buttons, no images`
    } else if (isPricingGrid) {
      layout = `PRICING SECTION — 2-3 plan cards with price, features list, CTA button`
    } else if (isQuote) {
      layout = `TESTIMONIALS — ${Math.max(1, Math.round(sec.length / 400))} quote cards with author name and role`
    } else if (isSplit && totalImgs >= 1) {
      const side = secNum % 2 === 0 ? 'RIGHT text, LEFT image' : 'LEFT text, RIGHT image'
      layout = `SPLIT LAYOUT — 50/50 flex row: ${side}. LARGE heading (text-5xl+), paragraph, optional button. ${totalImgs > 1 ? totalImgs + ' images' : '1 large image or UI screenshot'} on image side.`
      if (videoCount > 0) layout += ` + ${videoCount} video`
    } else if (totalImgs >= 5 || (totalImgs >= 3 && hasGrid)) {
      layout = `IMAGE GRID — ${totalImgs} images in a ${Math.ceil(totalImgs / 2)}-column mosaic or gallery grid`
    } else if ((listItemCount >= 3 || cardPatterns >= 2) && hasGrid) {
      layout = `CARD GRID — ${Math.max(listItemCount, cardPatterns, 3)} cards in a ${Math.min(4, Math.ceil(listItemCount / 2))}-column grid. Each card: icon/image, heading, short text`
    } else if (totalImgs >= 1) {
      layout = `CONTENT SECTION with ${totalImgs} image(s) — mixed text and images`
    } else {
      layout = `TEXT SECTION — heading, paragraph, optional button`
    }

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

  return parts.join('\n')
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

  const systemPrompt = `You are an elite web designer rebuilding a cloned site for a new brand with HIGH VISUAL FIDELITY to the original's design language.

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

━━━ DESIGN PHILOSOPHY ━━━
Build clean, modern SaaS landing pages. NO random stock photos. Use icons, typography, UI mockups, and geometric shapes instead.

━━━ LAYOUT PATTERNS ━━━

HERO: large bold heading + subtext + 2 buttons + UI wireframe mockup (gray skeleton box with icon, no real photo)
LOGO BAR: "TRUSTED BY X TEAMS" label + 5-7 company names in muted gray
ICON FEATURE GRID: 3-column grid, each cell has Font Awesome icon + bold title + 2-sentence description. NO images.
BENTO GRID: dark card (bg-gray-900, white text) side by side with light card (bg-white, border) containing a checklist of features
TESTIMONIALS: 2-3 quote cards in a grid, each with quote text + avatar initial + author name/role
CTA SECTION: centered, large heading, 2 buttons (dark primary + white border secondary), small "no credit card" note
FOOTER: logo + tagline col, then 3-4 link columns, bottom bar with copyright + social icons

━━━ RULES ━━━
- NO stock photos. NO picsum images. Use Font Awesome icons and UI skeleton mockups only.
- Buttons: rounded-lg bg-gray-900 text-white (primary), bg-white border border-gray-200 (secondary)
- Nav: font-bold logo + horizontal links + dark CTA button
- Alternating section backgrounds: bg-white and bg-gray-50
- Mobile responsive on every section
- Original compelling copy — no Lorem ipsum

Output ONLY raw HTML from <!DOCTYPE html> to </html>. No markdown. No explanation.`

  const prompt = `${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}BRAND: ${userMessage}

━━━ ORIGINAL SITE HTML ━━━
Use the full HTML below as your base. Rebuild it for the brand above — keep the same sections and structure, but replace all content, colors, and visuals with brand-appropriate equivalents. Follow the design system above exactly.

${currentHtml}

━━━ BUILD INSTRUCTIONS ━━━
- Replicate every section from the original in the same order
- Use ICON FEATURE GRID for feature sections (no photos)
- Use BENTO GRID for highlight/comparison sections
- Use UI MOCKUP placeholder in the hero
- Replace all colors with the brand palette
- Output a complete, self-contained page`

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
 * Non-streaming brand rebuild — used by the background job pattern.
 * Waits for the full Gemini response before returning, so there are no
 * streaming timeouts or partial-HTML issues.
 */
export async function chatWithProjectGemini(
  currentHtml: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  uploadedImageUrls?: string[]
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
    const systemPrompt = `You are an elite web designer rebuilding a cloned site for a new brand with HIGH VISUAL FIDELITY to the original's design language.

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

━━━ DESIGN PHILOSOPHY ━━━
Build clean, modern SaaS landing pages. NO random stock photos. Use icons, typography, UI mockups, and geometric shapes instead.

━━━ LAYOUT PATTERNS ━━━

HERO SECTION — large bold heading + subtext + 2 buttons + UI mockup below:
<section class="bg-white pt-24 pb-0 px-8 text-center">
  <div class="max-w-4xl mx-auto">
    <p class="text-sm font-semibold uppercase tracking-widest text-gray-400 mb-6">● V2.0 IS NOW LIVE</p>
    <h1 class="text-6xl lg:text-7xl font-black tracking-tighter text-gray-900 leading-none mb-6">Hero heading<br>here.</h1>
    <p class="text-xl text-gray-500 mb-8 max-w-2xl mx-auto">Subheadline text goes here.</p>
    <div class="flex items-center justify-center gap-4 flex-wrap">
      <a href="#" class="px-6 py-3 bg-gray-900 text-white rounded-lg font-semibold hover:bg-gray-800 transition">Primary CTA →</a>
      <a href="#" class="px-6 py-3 bg-white text-gray-900 rounded-lg font-semibold border border-gray-200 hover:bg-gray-50 transition">Secondary CTA</a>
    </div>
    <!-- UI Mockup -->
    <div class="mt-16 max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl border border-gray-200 p-6">
      <div class="flex items-center gap-2 mb-4"><div class="w-3 h-3 rounded-full bg-red-400"></div><div class="w-3 h-3 rounded-full bg-yellow-400"></div><div class="w-3 h-3 rounded-full bg-green-400"></div></div>
      <div class="space-y-3">
        <div class="h-4 bg-gray-100 rounded w-3/4"></div><div class="h-4 bg-gray-100 rounded w-1/2"></div>
        <div class="h-32 bg-gray-50 rounded-xl flex items-center justify-center text-gray-300 border border-gray-100"><i class="fas fa-calendar-alt text-5xl"></i></div>
        <div class="grid grid-cols-3 gap-2"><div class="h-3 bg-gray-100 rounded"></div><div class="h-3 bg-gray-100 rounded"></div><div class="h-3 bg-gray-100 rounded"></div></div>
      </div>
    </div>
  </div>
</section>

LOGO BAR — social proof strip:
<section class="py-12 px-8 border-y border-gray-100">
  <p class="text-center text-xs font-semibold uppercase tracking-widest text-gray-400 mb-8">TRUSTED BY 10,000+ TEAMS</p>
  <div class="max-w-4xl mx-auto flex items-center justify-center flex-wrap gap-10">
    <span class="text-xl font-bold text-gray-300">AcmeCorp</span>
    <span class="text-xl font-bold text-gray-300">Globex</span>
    <span class="text-xl font-bold text-gray-300">Soylent</span>
    <span class="text-xl font-bold text-gray-300">Initech</span>
    <span class="text-xl font-bold text-gray-300">Umbrella</span>
  </div>
</section>

ICON FEATURE GRID — 3 columns, no images, icons only:
<section class="py-24 px-8 bg-white">
  <div class="max-w-5xl mx-auto">
    <div class="text-center mb-16">
      <h2 class="text-4xl lg:text-5xl font-bold text-gray-900">Section heading</h2>
      <p class="text-lg text-gray-400 mt-4">Subtext</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-12">
      <div class="space-y-3">
        <div class="w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><i class="fas fa-calendar text-xl"></i></div>
        <h3 class="text-lg font-semibold text-gray-900">Feature Name</h3>
        <p class="text-gray-500 leading-relaxed">2 sentence description.</p>
      </div>
    </div>
  </div>
</section>

BENTO GRID — dark card + light feature list (for highlight sections):
<section class="py-24 px-8 bg-gray-50">
  <div class="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div class="bg-gray-900 rounded-3xl p-10 text-white">
      <h3 class="text-3xl font-bold mb-4">Dark card heading</h3>
      <p class="text-gray-400 leading-relaxed">Description text.</p>
      <a href="#" class="mt-8 inline-flex items-center text-white font-semibold gap-2">Learn more <i class="fas fa-arrow-right text-sm"></i></a>
    </div>
    <div class="bg-white rounded-3xl p-10 border border-gray-100 space-y-6">
      <div class="flex items-start gap-4"><div class="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas fa-check text-indigo-600 text-xs"></i></div><div><h4 class="font-semibold text-gray-900">Feature one</h4><p class="text-gray-500 text-sm mt-1">Short description.</p></div></div>
      <div class="flex items-start gap-4"><div class="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas fa-check text-indigo-600 text-xs"></i></div><div><h4 class="font-semibold text-gray-900">Feature two</h4><p class="text-gray-500 text-sm mt-1">Short description.</p></div></div>
      <div class="flex items-start gap-4"><div class="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas fa-check text-indigo-600 text-xs"></i></div><div><h4 class="font-semibold text-gray-900">Feature three</h4><p class="text-gray-500 text-sm mt-1">Short description.</p></div></div>
    </div>
  </div>
</section>

TESTIMONIALS — quote cards grid:
<section class="py-24 px-8 bg-white">
  <div class="max-w-5xl mx-auto">
    <h2 class="text-4xl font-bold text-gray-900 text-center mb-16">What our users say</h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="bg-gray-50 rounded-2xl p-6 border border-gray-100">
        <p class="text-gray-600 leading-relaxed mb-6">"Quote text here. Make it authentic and specific."</p>
        <div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center font-bold text-gray-500">A</div><div><p class="font-semibold text-gray-900 text-sm">Author Name</p><p class="text-gray-400 text-xs">Title, Company</p></div></div>
      </div>
    </div>
  </div>
</section>

CTA SECTION:
<section class="py-32 px-8 bg-white text-center">
  <div class="max-w-3xl mx-auto">
    <h2 class="text-5xl font-bold text-gray-900 mb-6">Ready to get started?</h2>
    <p class="text-xl text-gray-400 mb-10">Join thousands of teams already using [brand].</p>
    <div class="flex items-center justify-center gap-4"><a href="#" class="px-8 py-4 bg-gray-900 text-white rounded-lg font-semibold hover:bg-gray-800 transition">Sign up free</a><a href="#" class="px-8 py-4 bg-white text-gray-900 rounded-lg font-semibold border border-gray-200">Contact Sales</a></div>
    <p class="text-sm text-gray-400 mt-4">No credit card required. Cancel anytime.</p>
  </div>
</section>

FOOTER — multi-column with logo:
<footer class="bg-white border-t border-gray-100 py-16 px-8">
  <div class="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
    <div class="col-span-2 md:col-span-1"><p class="font-bold text-gray-900 text-lg mb-3">Brand</p><p class="text-gray-400 text-sm leading-relaxed">Short tagline or description.</p></div>
    <div><p class="font-semibold text-gray-900 text-sm mb-4">Product</p><ul class="space-y-2 text-sm text-gray-500"><li>Features</li><li>Pricing</li><li>Changelog</li></ul></div>
    <div><p class="font-semibold text-gray-900 text-sm mb-4">Company</p><ul class="space-y-2 text-sm text-gray-500"><li>About</li><li>Blog</li><li>Careers</li></ul></div>
    <div><p class="font-semibold text-gray-900 text-sm mb-4">Legal</p><ul class="space-y-2 text-sm text-gray-500"><li>Privacy</li><li>Terms</li></ul></div>
  </div>
  <div class="max-w-6xl mx-auto mt-12 pt-8 border-t border-gray-100 flex items-center justify-between text-sm text-gray-400"><p>© 2025 Brand. All rights reserved.</p><div class="flex gap-4"><i class="fab fa-twitter"></i><i class="fab fa-github"></i><i class="fab fa-linkedin"></i></div></div>
</footer>

━━━ TYPOGRAPHY ━━━
- Hero: text-6xl lg:text-7xl font-black tracking-tighter
- Section headings: text-4xl lg:text-5xl font-bold
- Body: text-lg text-gray-500 leading-relaxed
- Labels above headings: text-xs font-semibold uppercase tracking-widest text-gray-400

━━━ RULES ━━━
- NO random stock photos (no picsum). Use icons, UI mockups, and typography instead.
- Nav: logo (font-bold) + horizontal links + dark CTA button
- Buttons: rounded-lg (not rounded-full), dark bg-gray-900 primary, white border secondary
- Light background throughout: bg-white or bg-gray-50 for alternating sections
- Mobile responsive on every section
- Original compelling copy — no Lorem ipsum

Output ONLY raw HTML from <!DOCTYPE html> to </html>. No markdown. No explanation.`

    const prompt = `BRAND: ${userMessage}

━━━ ORIGINAL SITE HTML ━━━
Use the full HTML below as your base. Rebuild it for the brand above — keep the same sections and structure, but replace all content, colors, and visuals with brand-appropriate equivalents. Follow the design system above exactly.

${currentHtml}

━━━ BUILD INSTRUCTIONS ━━━
- Replicate every section from the original in the same order
- Use ICON FEATURE GRID for feature sections (no photos)
- Use BENTO GRID for highlight/comparison sections
- Use UI MOCKUP placeholder in the hero (no real photos)
- Replace all colors with the brand palette
- Output a complete, self-contained page`

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
    const systemPrompt = `You are a precise HTML editor. The user wants to make a specific, targeted change to an existing webpage.

CRITICAL RULES:
- Make ONLY the change the user explicitly requests — nothing else
- NEVER change brand names, company names, logo text, headings, body copy, or any text content unless the user explicitly asks to change text
- NEVER rename, rebrand, or rewrite content — treat all existing text as sacred
- Do NOT change fonts, colors, layout, or anything not mentioned
- Do NOT "improve", "clean up", or "modernize" anything
- Preserve every class, style, attribute, and element exactly as-is except the one thing being changed
- If the user says "change X to Y", change only X

Output ONLY the complete raw HTML from <!DOCTYPE html> to </html>. No markdown. No explanation.`

    const prompt = `${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}CURRENT HTML:
${currentHtml}

USER REQUEST: ${userMessage}

Apply ONLY the requested change(s) to the HTML above and return the complete modified page.`

    const { text: fullHtml, tokensUsed, inputTokens, outputTokens } = await generateText(prompt, { systemPrompt, maxTokens: 65536 })
    const cost = geminiCost(inputTokens ?? 0, outputTokens ?? 0)
    console.log(`[gemini] edit — input: ${inputTokens} tokens, output: ${outputTokens} tokens, cost: $${cost.toFixed(4)}`)

    const htmlStart = /<!DOCTYPE html/i.test(fullHtml)
      ? fullHtml.search(/<!DOCTYPE html/i)
      : fullHtml.search(/<html/i)

    const cleaned = htmlStart >= 0
      ? fullHtml.slice(htmlStart).replace(/\n?```\s*$/, '').trim()
      : fullHtml.replace(/\n?```\s*$/, '').trim()

    if (!cleaned || !/<html/i.test(cleaned) || !/<\/html>/i.test(cleaned)) {
      return { html: currentHtml, message: 'Could not apply the change. Please try again.', tokensUsed, estimatedCost: cost }
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
