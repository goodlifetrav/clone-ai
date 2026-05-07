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

  const systemPrompt = `You are an elite web designer. Your job is to take a cloned website's structure and rebuild it as a brand-new, launch-ready website for a different brand — same number of sections, same layout patterns, completely new content and styling.

REQUIRED <head> setup:
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  theme: { extend: {
    colors: { brand: { 50:'#fdf8f0', 100:'#f5e6c8', 300:'#c8956c', 500:'#8B5E3C', 700:'#5C3A1E', 900:'#2C1810' } },
    fontFamily: { sans:['Inter','sans-serif'], display:['Playfair Display','serif'] }
  }}
}
</script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

Override the tailwind.config brand colors to match the requested brand palette.

SECTION RULES:
- Count every distinct section in the cloned HTML structure provided
- Build EVERY one of them — do not skip, merge, or drop any section
- Match the section ORDER from the original
- Match the layout pattern of each section (grid, split, full-width banner, cards, etc.)
- Replace ALL content with new brand content — zero original text, logos, or images

IMAGE RULES:
- Background images: style="background-image:url('https://picsum.photos/seed/WORD/1920/1080')"
- Content images: <img src="https://picsum.photos/seed/WORD/800/500" ...>
- WORD must be a SINGLE lowercase English word with NO spaces — e.g.: coffee, espresso, barista, latte, cafe, beans, pastry, interior, workspace, team, product, city, people, office
- Use a DIFFERENT word for every image
- Never use broken paths, data URIs, or empty src attributes

QUALITY RULES:
- Nav links: flex gap-8 — never let them run together without spacing
- Hero: min-h-screen background image with overlay, font-display headline, two CTA buttons
- Cards/sections: shadow-lg rounded-2xl, proper padding
- Buttons: transition-all duration-300 hover:opacity-90
- Use brand-500/brand-700 for primary colors throughout
- Font Awesome icons (fa-solid, fa-brands) where the original had icons
- Original, compelling marketing copy — no Lorem ipsum, no placeholder text
- Fully mobile responsive with sm: md: lg: breakpoints

Output ONLY raw HTML from <!DOCTYPE html> to </html>. No markdown. No explanation.`

  // Use the actual HTML structure as the blueprint — this is what drives section count
  const pageStructure = currentHtml.length > 200
    ? extractPageStructure(currentHtml)
    : 'No cloned HTML available — build a standard full-page landing site.'

  const prompt = `${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}BRAND TO BUILD FOR: ${userMessage}

CLONED SITE STRUCTURE (use this as your section blueprint — replicate every section you see here):
${pageStructure}

Analyze the structure above, identify every section, then build the complete new website with identical section count and layout patterns but entirely new brand content.`

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
    const systemPrompt = `You are an elite web designer. Your job is to take a cloned website's structure and rebuild it as a brand-new, launch-ready website for a different brand — same number of sections, same layout patterns, completely new content and styling.

REQUIRED <head> setup:
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = {
  theme: { extend: {
    colors: { brand: { 50:'#fdf8f0', 100:'#f5e6c8', 300:'#c8956c', 500:'#8B5E3C', 700:'#5C3A1E', 900:'#2C1810' } },
    fontFamily: { sans:['Inter','sans-serif'], display:['Playfair Display','serif'] }
  }}
}
</script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">

Set tailwind.config brand colors to match the requested brand palette.

SECTION RULES:
- Count every distinct section in the cloned HTML structure provided
- Build EVERY one of them — do not skip, merge, or drop any section
- Match the section ORDER from the original
- Match the layout pattern of each section (grid, split, full-width banner, cards, etc.)
- Replace ALL content with new brand content — zero original text, logos, or images

IMAGE RULES:
- Background images: style="background-image:url('https://picsum.photos/seed/WORD/1920/1080')"
- Content images: <img src="https://picsum.photos/seed/WORD/800/500" ...>
- WORD must be a SINGLE lowercase English word with NO spaces — e.g.: coffee, espresso, barista, latte, cafe, beans, pastry, interior, workspace, team, product, city, people, office
- Use a DIFFERENT word for every image
- Never use broken paths, data URIs, or empty src attributes

QUALITY RULES:
- Nav links: flex gap-8 — never let them run together without spacing
- Hero: min-h-screen background image with overlay, font-display headline, two CTA buttons
- Cards/sections: shadow-lg rounded-2xl, proper padding
- Buttons: transition-all duration-300 hover:opacity-90
- Use brand-500/brand-700 for primary colors throughout
- Font Awesome icons (fa-solid, fa-brands) where the original had icons
- Original, compelling marketing copy — no Lorem ipsum, no placeholder text
- Fully mobile responsive with sm: md: lg: breakpoints

Output ONLY raw HTML from <!DOCTYPE html> to </html>. No markdown. No explanation.`

    const pageStructure = currentHtml.length > 200
      ? extractPageStructure(currentHtml)
      : 'No cloned HTML available — build a standard full-page landing site.'

    const prompt = `BRAND TO BUILD FOR: ${userMessage}

CLONED SITE STRUCTURE (use this as your section blueprint — replicate every section you see here):
${pageStructure}

Analyze the structure above, identify every section, then build the complete new website with identical section count and layout patterns but entirely new brand content.`

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
