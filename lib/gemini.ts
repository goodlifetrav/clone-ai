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
 * Detect the rough section structure of a cloned page so we can tell Gemini
 * what kind of layout to produce — without sending any actual HTML content.
 */
function detectPageSections(html: string): string {
  const lower = html.toLowerCase()
  const sections: string[] = ['navigation bar']

  if (/hero|banner|jumbotron|headline/.test(lower)) sections.push('hero section with headline and CTA button')
  if (/feature|benefit|why us|how it works/.test(lower)) sections.push('features or benefits section')
  if (/testimonial|review|customer|quote/.test(lower)) sections.push('testimonials or social proof section')
  if (/pricing|plan|tier|subscription/.test(lower)) sections.push('pricing section')
  if (/faq|frequently asked|question/.test(lower)) sections.push('FAQ section')
  if (/team|about|our story|who we are/.test(lower)) sections.push('about or team section')
  if (/blog|article|post|news/.test(lower)) sections.push('blog or news section')
  if (/contact|get in touch|reach us/.test(lower)) sections.push('contact section')
  if (/footer/.test(lower)) sections.push('footer with links and copyright')

  return sections.join(', ')
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
      return !c.startsWith('error:') && !c.includes('could not parse') && !c.includes('could not apply')
    })
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n')

  // Detect what sections the cloned page had — send a plain-text description
  // instead of actual HTML to avoid all parsing/token issues
  const pageSections = currentHtml.length > 100 ? detectPageSections(currentHtml) : 'navigation bar, hero section, features section, footer'

  const systemPrompt = `You are an expert web designer. Build a complete, professional multi-section landing page using Tailwind CSS.

RULES:
1. Use Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script> in <head> — this handles ALL styling, write NO custom CSS
2. MUST include ALL sections: sticky nav with logo, hero with headline + CTA, features/benefits grid, testimonials, about or CTA banner, footer
3. Use Tailwind classes directly on elements for all styling — colors, spacing, typography, layout
4. Images: use https://picsum.photos/seed/KEYWORD/1200/600 (replace KEYWORD with a relevant word like "coffee" or "interior")
5. Write compelling original copy for every section — no placeholder text
6. Output ONLY raw HTML starting with <!DOCTYPE html> and ending with </html> — no markdown, no explanation`

  const prompt = `${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}Brand: ${userMessage}

Page sections to include: ${pageSections}

Build the complete page now using Tailwind CSS classes for all styling.`

  let fullHtml = ''
  const { tokensUsed } = await generateTextStreaming(prompt, {
    systemPrompt,
    maxTokens: 16000,
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

  if (!fullHtml || !/<html/i.test(fullHtml)) {
    return {
      html: currentHtml,
      message: 'Could not apply the changes. Please try again.',
      tokensUsed,
    }
  }

  return {
    html: fullHtml,
    message: 'Done.',
    tokensUsed,
  }
}

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY
}
