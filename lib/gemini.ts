import { GoogleGenerativeAI } from '@google/generative-ai'

let _client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (!_client) {
    const key = process.env.GEMINI_API_KEY
    if (!key) throw new Error('GEMINI_API_KEY is not set')
    _client = new GoogleGenerativeAI(key)
  }
  return _client
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
  const client = getClient()
  const model = client.getGenerativeModel({
    model: 'gemini-2.5-flash',
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
  const client = getClient()
  const model = client.getGenerativeModel({
    model: 'gemini-2.5-flash',
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
}

/**
 * Chat-edit: asks Gemini to produce a JS DOM script + explanation (JSON).
 * Injects the script into the HTML and returns the updated page.
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

  const bodyIdx = currentHtml.search(/<body|<main/i)
  const startIdx = bodyIdx !== -1 ? bodyIdx : 0
  const htmlSnippet = currentHtml.slice(startIdx, startIdx + 3000)

  const systemPrompt = `You are a website editor. The user will describe a change they want to make to a website. Return ONLY a valid JSON object with no explanation, no markdown, no code blocks:
{
  "explanation": "brief description of what you changed",
  "script": "javascript code that manipulates the DOM to make the change"
}

Rules for the script:
- For background color changes: ONLY target high-level container elements using document.querySelectorAll('html, body, #__next, #root, main, .main, [class*="container"], [class*="wrapper"], [class*="layout"]') — never use * or target every element
- For text color changes: target text elements specifically: document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, a, li, td, th, label, button')
- Always use element.style.setProperty('property', 'value', 'important')
- For text content changes: find elements by checking element.textContent.trim() === 'exact text' then change element.textContent
- For image changes: find img elements and change their src attribute
- Never target '*' for background or color changes as it breaks the page
- Keep scripts concise and under 500 characters
- When you can see class names in the HTML snippet, target those specific classes in your script`

  const prompt = `Here is a snippet of the website HTML structure (CSS removed for brevity):
${htmlSnippet}

User request: ${userMessage}`

  const { text: raw, tokensUsed } = await generateText(prompt, {
    systemPrompt,
    maxTokens: 1000,
  })

  let explanation = 'Changes applied.'
  let script = ''
  try {
    let jsonText = raw
      .replace(/^```(?:json|JSON)?\s*/m, '')
      .replace(/```\s*$/m, '')
      .trim()
    const start = jsonText.indexOf('{')
    const end = jsonText.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      jsonText = jsonText.slice(start, end + 1)
    }
    const parsed = JSON.parse(jsonText)
    explanation = parsed.explanation ?? explanation
    script = parsed.script ?? ''
  } catch {
    return {
      html: currentHtml,
      message: 'Could not parse the changes. Please try again.',
      tokensUsed,
    }
  }

  if (!script.trim()) {
    return {
      html: currentHtml,
      message: 'That change could not be made. Please try a different request.',
      tokensUsed,
    }
  }

  // Collect all previous chat-edit scripts and combine with new one
  const previousScripts: string[] = []
  const prevRe = /<script data-chat-edit>([\s\S]*?)<\/script>/g
  let prevMatch: RegExpExecArray | null
  while ((prevMatch = prevRe.exec(currentHtml)) !== null) {
    if (prevMatch[1].trim()) previousScripts.push(prevMatch[1].trim())
  }
  const combinedScript = [...previousScripts, script].join('\n')

  let updatedHtml = currentHtml.replace(/<script data-chat-edit>[\s\S]*?<\/script>\n?/g, '')

  const scriptBlock = `<script data-chat-edit>${combinedScript}</script>`
  if (/<\/body>/i.test(updatedHtml)) {
    updatedHtml = updatedHtml.replace(/<\/body>/i, `${scriptBlock}\n</body>`)
  } else {
    updatedHtml = updatedHtml + '\n' + scriptBlock
  }

  onPartialHtml(updatedHtml)

  return {
    html: updatedHtml,
    message: explanation,
    tokensUsed,
  }
}

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY
}
