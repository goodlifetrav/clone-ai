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

  // Send the FULL HTML — Gemini 2.5 has a 1M token context, no reason to truncate
  // Strip only previous chat-edit scripts so the model gets clean markup
  const cleanHtml = currentHtml.replace(/<script data-chat-edit>[\s\S]*?<\/script>\n?/g, '')

  const systemPrompt = `You are an expert web developer editing a website. The user will describe a change they want. You MUST return the COMPLETE modified HTML document.

CRITICAL RULES — follow these exactly:
1. PRESERVE the entire page structure — every section, every nav item, every footer, every image, every CSS class
2. Make ONLY the specific changes the user asks for — nothing else
3. Keep ALL existing images with their exact src URLs unless the user asks to change an image
4. Keep ALL existing CSS, fonts, colors, and layout unless the user asks to change them
5. If the user asks to change text/copy — rewrite just the text content, keep all HTML tags and classes
6. If the user asks to change a color — update only those color values in the CSS
7. If the user asks to change a logo/image — update only that src attribute
8. Never simplify, never remove sections, never restructure — treat this like a surgical edit
9. Output ONLY the raw HTML starting with <!DOCTYPE html> — no markdown, no code fences, no explanation`

  const prompt = `${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}Here is the complete current HTML of the website:

${cleanHtml}

User request: ${userMessage}

Return the complete modified HTML with ONLY the requested changes applied. Keep everything else exactly the same.`

  let fullHtml = ''
  const { tokensUsed } = await generateTextStreaming(prompt, {
    systemPrompt,
    maxTokens: 65536,
    onReset: () => { fullHtml = '' }, // clear on retry so no partial HTML bleeds through
    onChunk: (chunk) => {
      fullHtml += chunk
      // Strip any markdown fences from partial output before sending to editor
      const partial = fullHtml
        .replace(/^```html\n?/i, '')
        .replace(/^```\n?/, '')
      onPartialHtml(partial)
    },
  })

  // Clean up markdown fences from final output
  fullHtml = fullHtml
    .replace(/^```html\n?/i, '')
    .replace(/^```\n?/, '')
    .replace(/\n?```$/, '')
    .trim()

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
