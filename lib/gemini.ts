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
 * Strip a cloned HTML page down to its structural skeleton so Gemini can use
 * it as a layout template without being constrained by the original content or
 * running into output-token limits trying to reproduce a massive site verbatim.
 */
function extractHtmlStructure(html: string, maxChars = 25000): string {
  let result = html
  // Strip scripts — use greedy inner match to handle </script> inside string literals
  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  // Strip styles (not needed in a structural skeleton)
  result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  result = result.replace(/<!--[\s\S]*?-->/g, '')
  result = result.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
  result = result.replace(/<svg\b(?![^>]*\b(?:title|aria-label)\b)[^>]*>[\s\S]*?<\/svg>/gi, '')
  // Remove long orphaned text nodes — these are usually JS code that leaked through
  // script stripping (e.g. when a script contained </script> in a string literal)
  result = result.replace(/>([^<]{150,})</g, '><')
  // Keep only layout-relevant attributes
  const ALLOWED = new Set(['class', 'id', 'style', 'src', 'href', 'rel', 'type'])
  result = result.replace(/<([a-z][a-z0-9-]*)(\s[^>]*)?(\/?)>/gi, (_m, tag: string, attrStr: string | undefined, sc: string) => {
    if (!attrStr) return `<${tag}${sc}>`
    const kept = (attrStr.match(/\b([a-z][a-z0-9:-]*)=(?:"[^"]*"|'[^']*'|[^\s>/]+)/gi) ?? [])
      .filter((a) => ALLOWED.has(a.split('=')[0].toLowerCase().trim()))
    return `<${tag}${kept.length ? ' ' + kept.join(' ') : ''}${sc}>`
  })
  result = result.replace(/\s+/g, ' ').trim()
  if (result.length > maxChars) result = result.slice(0, maxChars) + '…'
  return result
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

  // Use the structural skeleton as a layout template — this keeps token count
  // manageable and lets Gemini generate fresh original content (no copyright issues)
  const structureHtml = extractHtmlStructure(currentHtml)
  console.log('[chat] currentHtml length:', currentHtml.length)
  console.log('[chat] structureHtml length:', structureHtml.length)
  console.log('[chat] structureHtml preview:', structureHtml.slice(0, 500))

  const systemPrompt = `You are an expert web designer. You will receive the structural skeleton of a cloned website and the user's brand/content instructions. Your job is to build a completely NEW, original website inspired by that structure.

CRITICAL RULES:
1. Use the provided HTML skeleton as a LAYOUT TEMPLATE ONLY — keep the same sections, navigation pattern, and overall structure
2. Replace ALL original text, images, colors, and branding with fresh content based on the user's instructions
3. Remove every trace of the original site — different brand name, different copy, different color scheme
4. Write clean, modern HTML with all CSS in a <style> tag — no external CDN links, no scripts that reference the original site
5. Make it fully responsive for mobile and desktop
6. Output ONLY the complete HTML document starting with <!DOCTYPE html> — no markdown, no code fences, no explanation
7. Never use markdown syntax like **text** inside HTML — use proper tags like <strong>`

  const prompt = `${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}Here is the layout structure of the cloned website to use as a template:

${structureHtml}

User's brand/content instructions: ${userMessage}

Build a completely new, original website using this layout as a template. Replace all content with fresh original content. Output the complete HTML document.`

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
