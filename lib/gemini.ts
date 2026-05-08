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
      generationConfig: { maxOutputTokens: options.maxTokens ?? 1000 },
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
    /class="[^"]*dark(?:\s|")/i,
  ]
  const looksLightBg = html.match(/class="[^"]*bg-white/i) || html.match(/background(?:-color)?:\s*(?:#fff|white|#f[0-9a-f]{5})/i)
  const looksLikeDark = darkIndicators.some((re) => re.test(bodyMatch + htmlTagMatch + headStyles + html.slice(0, 4000)))

  if (looksLikeDark && !looksLightBg) {
    signals.push('DARK THEME: The original site uses a dark background (near-black or very dark). Your rebuild MUST use a dark theme — dark body/sections, light text.')
  } else {
    signals.push('LIGHT THEME: The original site uses a light background. Your rebuild should use a light theme.')
  }

  // ── Image density ────────────────────────────────────────────────────────
  const imgCount = (html.match(/<img\b/gi) ?? []).length
  const bgImgCount = (html.match(/background-image/gi) ?? []).length
  const totalImages = imgCount + bgImgCount

  if (totalImages >= 8) {
    signals.push('IMAGE-HEAVY: The original has many images/background images. Your rebuild should be visually dense with images — hero background images, product shots, lifestyle photography in multiple sections.')
  } else if (totalImages >= 3) {
    signals.push('MODERATE IMAGES: The original uses some images. Include hero background and a few content images.')
  } else {
    signals.push('MINIMAL IMAGES: The original is text/UI focused. Use minimal images — rely on color, typography, and UI elements instead.')
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

━━━ LAYOUT RULES BY SECTION TYPE ━━━

SPLIT LAYOUT sections (text + image side by side):
- Use: <div class="flex flex-col lg:flex-row items-center gap-16 py-24 px-8 max-w-7xl mx-auto">
- Text side (lg:w-1/2): heading in text-5xl lg:text-6xl font-bold, paragraph, optional button
- Image side (lg:w-1/2): <img src="https://picsum.photos/seed/WORD/900/600" class="w-full rounded-2xl shadow-2xl">
- Alternate which side text appears on (left for odd sections, right for even)

IMAGE MOSAIC GRID sections (hero or gallery):
- Use: <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
- Fill with: <img src="https://picsum.photos/seed/WORD/600/400" class="w-full h-48 object-cover rounded-xl">
- Use 6-12 images with DIFFERENT seed words

CARD GRID sections:
- Use: <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
- Each card: <div class="bg-white/5 rounded-2xl p-6 border border-white/10">
- Card contains: icon (Font Awesome), heading (text-xl font-semibold), description

LOGO BAR sections (social proof):
- Horizontal flex row of 5-7 brand/company names in text-xl font-semibold opacity-40

TESTIMONIAL sections:
- Grid of 2-3 quote cards; each has blockquote text, author name, role, company

CTA SECTION:
- Centered, py-32, large heading (text-5xl font-bold), subtext, 2 buttons

━━━ TYPOGRAPHY RULES ━━━
- Hero heading: text-6xl lg:text-7xl xl:text-8xl font-black tracking-tighter (if original has massive type)
- Feature section headings: text-4xl lg:text-5xl font-bold (NOT text-2xl — make them BIG)
- Body text: text-lg leading-relaxed
- Small labels above headings: text-sm font-semibold uppercase tracking-widest opacity-60

━━━ IMAGE RULES ━━━
- ALWAYS use: https://picsum.photos/seed/WORD/WIDTH/HEIGHT
- WORD = single lowercase English word, different for every image
- Good seed words: dashboard, interface, analytics, workflow, team, office, product, design, code, city, launch, scale, growth, connect, build
- Hero images: /seed/WORD/1920/1080
- Split section images: /seed/WORD/900/600
- Card/grid images: /seed/WORD/600/400

━━━ GENERAL RULES ━━━
- Nav: logo text + flex gap-8 nav links + CTA button — no wrapping
- All buttons: px-6 py-3 rounded-full font-semibold transition-all duration-300
- Fully mobile responsive — sm: md: lg: breakpoints on every section
- Original compelling copy — no Lorem ipsum
- Build EVERY section listed in SITE STRUCTURE — all of them, no exceptions.
  Long pages have 20-40 sections. Build all 20-40. Do not stop early.
  Do not merge sections. Do not skip sections. Output the complete page.

Output ONLY raw HTML from <!DOCTYPE html> to </html>. No markdown. No explanation.`

  const blueprint = currentHtml.length > 200
    ? buildPageBlueprint(currentHtml)
    : ''

  const styleSignals = currentHtml.length > 200
    ? extractStyleSignals(currentHtml)
    : ''

  const prompt = `${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}BRAND: ${userMessage}

━━━ ORIGINAL SITE STYLE ━━━
${styleSignals || 'No style data — use your best judgment.'}

━━━ ORIGINAL SITE BLUEPRINT ━━━
The blueprint below maps every section of the cloned site. Each [SECTION N] entry shows:
- The heading text (so you know what that section is about)
- Image/video/icon counts (so you know if it needs visual content)
- Context text (so you understand the section's purpose)
- The structural skeleton shows nesting depth and layout patterns

Use this to build every section in the same order, with the same layout complexity.

${blueprint || 'No blueprint — build a full-featured landing page for the brand described.'}

━━━ BUILD INSTRUCTIONS ━━━
Build every [SECTION N] listed above — all of them, in order, no exceptions.
- Sections with images: use SPLIT LAYOUT (text one side, large image other side)
- Sections with many list items: use CARD GRID
- Sections with no images and short text: use CENTERED CTA layout
- Match the section count exactly. Long-form pages have 15-30 sections — build all of them.`

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

━━━ LAYOUT RULES BY SECTION TYPE ━━━

SPLIT LAYOUT sections (text + image side by side):
- Use: <div class="flex flex-col lg:flex-row items-center gap-16 py-24 px-8 max-w-7xl mx-auto">
- Text side (lg:w-1/2): heading in text-5xl lg:text-6xl font-bold, paragraph, optional button
- Image side (lg:w-1/2): <img src="https://picsum.photos/seed/WORD/900/600" class="w-full rounded-2xl shadow-2xl">
- Alternate which side text appears on (left for odd sections, right for even)

IMAGE MOSAIC GRID sections (hero or gallery):
- Use: <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
- Fill with: <img src="https://picsum.photos/seed/WORD/600/400" class="w-full h-48 object-cover rounded-xl">
- Use 6-12 images with DIFFERENT seed words

CARD GRID sections:
- Use: <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
- Each card: <div class="bg-white/5 rounded-2xl p-6 border border-white/10">
- Card contains: icon (Font Awesome), heading (text-xl font-semibold), description

LOGO BAR sections (social proof):
- Horizontal flex row of 5-7 brand/company names in text-xl font-semibold opacity-40

TESTIMONIAL sections:
- Grid of 2-3 quote cards; each has blockquote text, author name, role, company

CTA SECTION:
- Centered, py-32, large heading (text-5xl font-bold), subtext, 2 buttons

━━━ TYPOGRAPHY RULES ━━━
- Hero heading: text-6xl lg:text-7xl xl:text-8xl font-black tracking-tighter (if original has massive type)
- Feature section headings: text-4xl lg:text-5xl font-bold (NOT text-2xl — make them BIG)
- Body text: text-lg leading-relaxed
- Small labels above headings: text-sm font-semibold uppercase tracking-widest opacity-60

━━━ IMAGE RULES ━━━
- ALWAYS use: https://picsum.photos/seed/WORD/WIDTH/HEIGHT
- WORD = single lowercase English word, different for every image
- Good seed words: dashboard, interface, analytics, workflow, team, office, product, design, code, city, launch, scale, growth, connect, build
- Hero images: /seed/WORD/1920/1080
- Split section images: /seed/WORD/900/600
- Card/grid images: /seed/WORD/600/400
- Square images: /seed/WORD/600/600

━━━ GENERAL RULES ━━━
- Nav: logo text + flex gap-8 nav links + CTA button — no wrapping
- All buttons: px-6 py-3 rounded-full font-semibold transition-all duration-300
- Fully mobile responsive — sm: md: lg: breakpoints on every section
- Original compelling copy — no Lorem ipsum
- Build EVERY section listed in SITE STRUCTURE — all of them, no exceptions.
  Long pages have 20-40 sections. Build all 20-40. Do not stop early.
  Do not merge sections. Do not skip sections. Output the complete page.

Output ONLY raw HTML from <!DOCTYPE html> to </html>. No markdown. No explanation.`

    const blueprint = currentHtml.length > 200
      ? buildPageBlueprint(currentHtml)
      : ''

    const styleSignals = currentHtml.length > 200
      ? extractStyleSignals(currentHtml)
      : ''

    const prompt = `BRAND: ${userMessage}

━━━ ORIGINAL SITE STYLE ━━━
${styleSignals || 'No style data — use your best judgment.'}

━━━ ORIGINAL SITE BLUEPRINT ━━━
The blueprint below maps every section of the cloned site. Each [SECTION N] entry shows:
- The heading text (so you know what that section is about)
- Image/video/icon counts (so you know if it needs visual content)
- Context text (so you understand the section's purpose)
- The structural skeleton shows nesting depth and layout patterns

Use this to build every section in the same order, with the same layout complexity.

${blueprint || 'No blueprint — build a full-featured landing page for the brand described.'}

━━━ BUILD INSTRUCTIONS ━━━
Build every [SECTION N] listed above — all of them, in order, no exceptions.
- Sections with images: use SPLIT LAYOUT (text one side, large image other side)
- Sections with many list items: use CARD GRID
- Sections with no images and short text: use CENTERED CTA layout
- Match the section count exactly. Long-form pages have 15-30 sections — build all of them.`

    const { text: fullHtml, tokensUsed, inputTokens, outputTokens } = await generateText(prompt, { systemPrompt, maxTokens: 65536 })
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
    const systemPrompt = `You are a precise HTML editor. The user wants to make specific changes to an existing webpage.

CRITICAL RULES:
- Make ONLY the changes the user explicitly requests — nothing else
- Do NOT change fonts, colors, layout, content, or anything not mentioned
- Do NOT "improve" or "clean up" anything that wasn't asked about
- Preserve every class, style, attribute, and element exactly as-is except where changed
- If the user says "change X to Y", change only X — leave all other instances of similar things untouched unless they explicitly say "all"
- If the user says "change all X to Y", change every instance of X

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
