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
): Promise<{ text: string; tokensUsed: number }> {
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
        const tokensUsed =
          (response.usageMetadata?.promptTokenCount ?? 0) +
          (response.usageMetadata?.candidatesTokenCount ?? 0)

        return { text: fullText, tokensUsed }
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
): Promise<{ text: string; tokensUsed: number }> {
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
    const tokensUsed =
      (result.response.usageMetadata?.promptTokenCount ?? 0) +
      (result.response.usageMetadata?.candidatesTokenCount ?? 0)

    return { text, tokensUsed }
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
 * Strip a cloned page down to its structural skeleton.
 * Removes all content, scripts, styles, and attributes — keeps only
 * the tag hierarchy and class names so Gemini can see the exact layout.
 */
function extractPageStructure(html: string): string {
  let stripped = html
    // Remove everything that isn't structure
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '<svg/>')
    .replace(/<img\b[^>]*\/?>/gi, '<img/>')
    .replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, '<video/>')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '<iframe/>')
    .replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, '<canvas/>')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Strip non-class attributes (keep class so Gemini sees layout patterns)
    .replace(/\s+(style|data-[a-z-]+|on\w+|aria-[a-z-]+|tabindex|id|name|value|placeholder|type|rel|target|href|src|alt|srcset|sizes|loading|decoding|fetchpriority|crossorigin|integrity|nonce)="[^"]*"/gi, '')
    // Replace long text nodes with a marker
    .replace(/>[^<]{25,}</g, '>[…]')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Cap at 24KB to stay well inside the input token budget
  if (stripped.length > 24000) {
    stripped = stripped.slice(0, 24000) + '\n[…structure truncated…]'
  }

  return stripped
}

export async function chatWithProjectStreamingGemini(
  currentHtml: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onPartialHtml: (partialHtml: string) => void,
  uploadedImageUrls?: string[]
): Promise<{ html: string; message: string; tokensUsed: number }> {
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

  const systemPrompt = `You are an elite web designer. Your job is to take a cloned website's structure and rebuild it as a brand-new, launch-ready website for a different brand.

Your goal is HIGH VISUAL FIDELITY to the original site's design language — same layout complexity, same visual weight, same aesthetic feel — applied to a completely new brand.

REQUIRED <head> setup:
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  theme: { extend: {
    colors: { brand: { 50:'#f0f9ff', 100:'#e0f2fe', 300:'#7dd3fc', 500:'#0ea5e9', 700:'#0369a1', 900:'#0c4a6e' } },
    fontFamily: { sans:['Inter','sans-serif'], display:['Inter','sans-serif'] }
  }}
}
</script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

STYLE SIGNALS (FOLLOW THESE EXACTLY — they describe the original site's visual style):
These rules override your defaults. Read them carefully and honour them.

SECTION RULES:
- Count every distinct section in the cloned HTML structure provided
- Build EVERY one of them — do not skip, merge, or drop any section
- Match the section ORDER from the original
- Match the layout pattern of each section (grid, split, full-width banner, cards, etc.)
- Replace ALL content with new brand content — zero original text, logos, or images

IMAGE RULES (only use images if the original was image-heavy — see STYLE SIGNALS):
- Background images: style="background-image:url('https://picsum.photos/seed/WORD/1920/1080')"
- Content images: <img src="https://picsum.photos/seed/WORD/800/500" ...>
- WORD must be a SINGLE lowercase English word — e.g.: tech, software, team, office, city, product, code, design, startup
- Use a DIFFERENT word for every image
- Never use broken paths, data URIs, or empty src attributes

QUALITY RULES:
- Nav links: flex gap-8 — never let them run together without spacing
- Cards/sections: proper padding, consistent spacing
- Buttons: transition-all duration-300 hover:opacity-90
- Font Awesome icons where the original had icons
- Original, compelling marketing copy — no Lorem ipsum
- Fully mobile responsive with sm: md: lg: breakpoints

Output ONLY raw HTML from <!DOCTYPE html> to </html>. No markdown. No explanation.`

  // Use the actual HTML structure as the blueprint — this is what drives section count
  const pageStructure = currentHtml.length > 200
    ? extractPageStructure(currentHtml)
    : 'No cloned HTML available — build a standard full-page landing site.'

  const styleSignals = currentHtml.length > 200
    ? extractStyleSignals(currentHtml)
    : ''

  const prompt = `${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}BRAND TO BUILD FOR: ${userMessage}

STYLE SIGNALS — Original site's visual characteristics (follow these precisely):
${styleSignals || 'No style data available — use your best judgment.'}

CLONED SITE STRUCTURE (use this as your section blueprint — replicate every section and layout pattern):
${pageStructure}

Analyze the structure above, identify every section, then build the complete new website that:
1. Matches the visual style described in STYLE SIGNALS (dark/light theme, image density, typography scale)
2. Replicates every section with identical layout patterns
3. Uses entirely new brand content appropriate for: ${userMessage}`

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
): Promise<{ html: string; message: string; tokensUsed: number }> {
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
    const systemPrompt = `You are an elite web designer. Your job is to take a cloned website's structure and rebuild it as a brand-new, launch-ready website for a different brand.

Your goal is HIGH VISUAL FIDELITY to the original site's design language — same layout complexity, same visual weight, same aesthetic feel — applied to a completely new brand.

REQUIRED <head> setup:
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  theme: { extend: {
    colors: { brand: { 50:'#f0f9ff', 100:'#e0f2fe', 300:'#7dd3fc', 500:'#0ea5e9', 700:'#0369a1', 900:'#0c4a6e' } },
    fontFamily: { sans:['Inter','sans-serif'], display:['Inter','sans-serif'] }
  }}
}
</script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

STYLE SIGNALS (FOLLOW THESE EXACTLY — they describe the original site's visual style):
These rules override your defaults. Read them carefully and honour them.

SECTION RULES:
- Count every distinct section in the cloned HTML structure provided
- Build EVERY one of them — do not skip, merge, or drop any section
- Match the section ORDER from the original
- Match the layout pattern of each section (grid, split, full-width banner, cards, etc.)
- Replace ALL content with new brand content — zero original text, logos, or images

IMAGE RULES (only use images if the original was image-heavy — see STYLE SIGNALS):
- Background images: style="background-image:url('https://picsum.photos/seed/WORD/1920/1080')"
- Content images: <img src="https://picsum.photos/seed/WORD/800/500" ...>
- WORD must be a SINGLE lowercase English word — e.g.: tech, software, team, office, city, product, code, design, startup
- Use a DIFFERENT word for every image
- Never use broken paths, data URIs, or empty src attributes

QUALITY RULES:
- Nav links: flex gap-8 — never let them run together without spacing
- Cards/sections: proper padding, consistent spacing
- Buttons: transition-all duration-300 hover:opacity-90
- Font Awesome icons where the original had icons
- Original, compelling marketing copy — no Lorem ipsum
- Fully mobile responsive with sm: md: lg: breakpoints

Output ONLY raw HTML from <!DOCTYPE html> to </html>. No markdown. No explanation.`

    const pageStructure = currentHtml.length > 200
      ? extractPageStructure(currentHtml)
      : 'No cloned HTML available — build a standard full-page landing site.'

    const styleSignals = currentHtml.length > 200
      ? extractStyleSignals(currentHtml)
      : ''

    const prompt = `BRAND TO BUILD FOR: ${userMessage}

STYLE SIGNALS — Original site's visual characteristics (follow these precisely):
${styleSignals || 'No style data available — use your best judgment.'}

CLONED SITE STRUCTURE (use this as your section blueprint — replicate every section and layout pattern):
${pageStructure}

Analyze the structure above, identify every section, then build the complete new website that:
1. Matches the visual style described in STYLE SIGNALS (dark/light theme, image density, typography scale)
2. Replicates every section with identical layout patterns
3. Uses entirely new brand content appropriate for: ${userMessage}`

    const { text: fullHtml, tokensUsed } = await generateText(prompt, { systemPrompt, maxTokens: 65536 })

    const htmlStart = /<!DOCTYPE html/i.test(fullHtml)
      ? fullHtml.search(/<!DOCTYPE html/i)
      : fullHtml.search(/<html/i)

    const cleaned = htmlStart >= 0
      ? fullHtml.slice(htmlStart).replace(/\n?```\s*$/, '').trim()
      : fullHtml.replace(/\n?```\s*$/, '').trim()

    if (!cleaned || !/<html/i.test(cleaned) || !/<\/html>/i.test(cleaned)) {
      return { html: currentHtml, message: 'Could not generate a complete page. Please try again.', tokensUsed }
    }

    return { html: cleaned, message: 'Done.', tokensUsed }

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

    const { text: fullHtml, tokensUsed } = await generateText(prompt, { systemPrompt, maxTokens: 65536 })

    const htmlStart = /<!DOCTYPE html/i.test(fullHtml)
      ? fullHtml.search(/<!DOCTYPE html/i)
      : fullHtml.search(/<html/i)

    const cleaned = htmlStart >= 0
      ? fullHtml.slice(htmlStart).replace(/\n?```\s*$/, '').trim()
      : fullHtml.replace(/\n?```\s*$/, '').trim()

    if (!cleaned || !/<html/i.test(cleaned) || !/<\/html>/i.test(cleaned)) {
      return { html: currentHtml, message: 'Could not apply the change. Please try again.', tokensUsed }
    }

    return { html: cleaned, message: 'Done.', tokensUsed }
  }
}

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY
}
