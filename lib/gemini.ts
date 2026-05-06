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
 * Generate text using Gemini 2.0 Flash with streaming.
 * onChunk is called for each streaming delta.
 * Returns { text, tokensUsed }.
 */
export async function generateTextStreaming(
  prompt: string,
  options: {
    systemPrompt?: string
    onChunk?: (chunk: string) => void
    maxTokens?: number
  } = {}
): Promise<{ text: string; tokensUsed: number }> {
  return withRetry(async (modelName) => {
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
  })
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

  // Build conversation history for context (last 6 turns max)
  const historyContext = messages.slice(-7, -1)
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n')

  // Strip previous chat-edit scripts so Gemini gets clean HTML
  const cleanHtml = currentHtml.replace(/<script data-chat-edit>[\s\S]*?<\/script>\n?/g, '')

  const systemPrompt = `You are an expert web developer editing a website's HTML. The user will request changes. You MUST return the complete modified HTML document — no explanations, no markdown, no code fences. Start your response with <!DOCTYPE html> or <html and end with </html>.

Rules:
- Preserve all existing styles, images, and structure unless the user asks to change them
- Make ONLY the changes the user requests
- For color changes: update the CSS in the <style> tag and/or inline styles
- For text changes: update the text content directly in the HTML
- For image changes: update the src attributes
- Keep all existing scripts and functionality intact
- Output the complete HTML — never truncate or abbreviate`

  const prompt = `${historyContext ? `Previous conversation:\n${historyContext}\n\n` : ''}Current HTML:
\`\`\`html
${cleanHtml.slice(0, 20000)}
\`\`\`

User request: ${userMessage}

Return the complete modified HTML document only.`

  let fullHtml = ''
  const { tokensUsed } = await generateTextStreaming(prompt, {
    systemPrompt,
    maxTokens: 16000,
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
