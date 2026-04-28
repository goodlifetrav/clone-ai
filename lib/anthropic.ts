import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export const MODEL = 'claude-sonnet-4-6'

export async function generateClone(
  htmlContent: string,
  screenshotBase64: string,
  url: string
): Promise<{ html: string; tokensUsed: number }> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: `You are an expert web developer specializing in HTML, CSS, and JavaScript.
Your task is to recreate websites as clean, self-contained HTML files.
- Output ONLY the complete HTML file, starting with <!DOCTYPE html>
- Inline all CSS in a <style> tag
- Use modern CSS (flexbox, grid, custom properties)
- Preserve the visual design, layout, colors, typography, and structure
- Make the clone responsive
- Replace external fonts with system fonts or Google Fonts CDN links
- Keep all text content from the original
- Do not include any external JavaScript that may fail
- Replace form submissions and external API calls with placeholder alerts
- Output nothing except the HTML code itself`,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: screenshotBase64,
            },
          },
          {
            type: 'text',
            text: `Please recreate this website (${url}) as a complete, self-contained HTML file.

Here is the original HTML source for reference:
\`\`\`html
${htmlContent.slice(0, 50000)}
\`\`\`

Create a clean, pixel-perfect clone as a single HTML file with all CSS inlined.`,
          },
        ],
      },
    ],
  })

  const content = response.content[0]
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude')
  }

  const raw = content.text

  // Extract the HTML document regardless of surrounding prose or code fences.
  // Look for content from <!DOCTYPE or <html through to the closing </html>.
  const htmlMatch = raw.match(/<!DOCTYPE\s+html[\s\S]*<\/html>/i)
    ?? raw.match(/<html[\s\S]*<\/html>/i)

  if (!htmlMatch) {
    // Fall back to stripping markdown fences if no document tags found
    let html = raw.trim()
    if (html.startsWith('```')) {
      html = html.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '').trim()
    }
    if (!html) {
      throw new Error('Claude returned empty HTML — please try again')
    }
    return { html, tokensUsed: response.usage.input_tokens + response.usage.output_tokens }
  }

  return {
    html: htmlMatch[0],
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  }
}

// Same as generateClone but streams partial HTML via onPartialHtml callback
// so the caller can save incremental progress to the database.
export async function generateCloneStreaming(
  htmlContent: string,
  screenshotBase64: string,
  url: string,
  onPartialHtml: (partialText: string) => Promise<void>
): Promise<{ html: string; tokensUsed: number }> {
  const SAVE_INTERVAL = 2000 // chars between DB saves

  const stream = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    stream: true,
    system: `You are an expert web developer specializing in HTML, CSS, and JavaScript.
Your task is to recreate websites as clean, self-contained HTML files.
- Output ONLY the complete HTML file, starting with <!DOCTYPE html>
- Inline all CSS in a <style> tag
- Use modern CSS (flexbox, grid, custom properties)
- Preserve the visual design, layout, colors, typography, and structure
- Make the clone responsive
- Replace external fonts with system fonts or Google Fonts CDN links
- Keep all text content from the original
- Do not include any external JavaScript that may fail
- Replace form submissions and external API calls with placeholder alerts
- Output nothing except the HTML code itself`,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: screenshotBase64,
            },
          },
          {
            type: 'text',
            text: `Please recreate this website (${url}) as a complete, self-contained HTML file.

Here is the original HTML source for reference:
\`\`\`html
${htmlContent.slice(0, 50000)}
\`\`\`

Create a clean, pixel-perfect clone as a single HTML file with all CSS inlined.`,
          },
        ],
      },
    ],
  })

  let accumulated = ''
  let lastSaveLength = 0
  let inputTokens = 0
  let outputTokens = 0

  for await (const event of stream) {
    if (event.type === 'message_start') {
      inputTokens = event.message.usage.input_tokens
    } else if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      accumulated += event.delta.text
      if (accumulated.length - lastSaveLength >= SAVE_INTERVAL) {
        lastSaveLength = accumulated.length
        await onPartialHtml(accumulated)
      }
    } else if (event.type === 'message_delta') {
      outputTokens = event.usage.output_tokens
    }
  }

  // Synthesise a usage object matching what generateClone returns
  const finalMessage = { usage: { input_tokens: inputTokens, output_tokens: outputTokens } }

  const htmlMatch =
    accumulated.match(/<!DOCTYPE\s+html[\s\S]*<\/html>/i) ??
    accumulated.match(/<html[\s\S]*<\/html>/i)

  let html: string
  if (!htmlMatch) {
    html = accumulated.trim()
    if (html.startsWith('```')) {
      html = html.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '').trim()
    }
    if (!html) {
      throw new Error('Claude returned empty HTML — please try again')
    }
  } else {
    html = htmlMatch[0]
  }

  return {
    html,
    tokensUsed: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
  }
}

// Streaming version of chatWithProject.
// Calls onPartialHtml with the HTML section as it is generated so the caller
// can push chunks to the client in real time.
export async function chatWithProjectStreaming(
  currentHtml: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onPartialHtml: (partialHtml: string) => void,
  imageBase64?: string,
  imageMimeType?: string
): Promise<{ html: string; message: string; tokensUsed: number }> {
  const lastUserMessage = messages[messages.length - 1]
  const CHUNK_INTERVAL = 800 // chars between onPartialHtml calls
  const HTML_MARKER = 'HTML:\n'

  const userContent: Anthropic.MessageParam['content'] = []
  if (imageBase64 && imageMimeType) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: imageMimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data: imageBase64,
      },
    })
  }
  userContent.push({
    type: 'text',
    text: `Here is the current HTML of the website:\n\`\`\`html\n${currentHtml}\n\`\`\`\n\n${lastUserMessage.content}`,
  })

  const stream = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    stream: true,
    system: `You are an expert web developer helping users modify their cloned website.
The user will ask you to make changes to the HTML.

IMPORTANT: Always respond with:
1. A brief explanation of what you changed (1-3 sentences)
2. Then the complete updated HTML file

Format your response EXACTLY like this:
EXPLANATION: [your explanation here]
HTML:
[complete html file starting with <!DOCTYPE html>]

Always output the complete HTML file, not just the changed parts.`,
    messages: [{ role: 'user', content: userContent }],
  })

  let accumulated = ''
  let lastChunkAt = 0
  let inputTokens = 0
  let outputTokens = 0

  for await (const event of stream) {
    if (event.type === 'message_start') {
      inputTokens = event.message.usage.input_tokens
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      accumulated += event.delta.text

      // Once the HTML section starts, emit partial HTML on each interval
      const markerIdx = accumulated.indexOf(HTML_MARKER)
      if (markerIdx !== -1 && accumulated.length - lastChunkAt >= CHUNK_INTERVAL) {
        lastChunkAt = accumulated.length
        let partial = accumulated.slice(markerIdx + HTML_MARKER.length)
        if (partial.startsWith('```')) {
          partial = partial.replace(/^```(?:html)?\n?/, '')
        }
        if (partial.trim()) onPartialHtml(partial.trim())
      }
    } else if (event.type === 'message_delta') {
      outputTokens = event.usage.output_tokens
    }
  }

  // Parse final result
  const explanationMatch = accumulated.match(/EXPLANATION:\s*([\s\S]*?)(?=\nHTML:|$)/)
  const htmlMatch = accumulated.match(/HTML:\s*\n?([\s\S]*)$/)

  let explanation = explanationMatch ? explanationMatch[1].trim() : 'Changes applied.'
  let html = htmlMatch ? htmlMatch[1].trim() : currentHtml
  if (html.startsWith('```')) {
    html = html.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '').trim()
  }

  return {
    html,
    message: explanation,
    tokensUsed: inputTokens + outputTokens,
  }
}

export async function chatWithProject(
  currentHtml: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  imageBase64?: string,
  imageMimeType?: string
): Promise<{ html: string; message: string; tokensUsed: number }> {
  const lastUserMessage = messages[messages.length - 1]

  const userContent: Anthropic.MessageParam['content'] = []

  if (imageBase64 && imageMimeType) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: imageMimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data: imageBase64,
      },
    })
  }

  userContent.push({
    type: 'text',
    text: lastUserMessage.content,
  })

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: `You are an expert web developer helping users modify their cloned website.
The user will ask you to make changes to the HTML.

IMPORTANT: Always respond with:
1. A brief explanation of what you changed (1-3 sentences)
2. Then the complete updated HTML file

Format your response EXACTLY like this:
EXPLANATION: [your explanation here]
HTML:
[complete html file starting with <!DOCTYPE html>]

Always output the complete HTML file, not just the changed parts.`,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Here is the current HTML of the website:\n\`\`\`html\n${currentHtml}\n\`\`\`\n\n${lastUserMessage.content}`,
          },
          ...(imageBase64 && imageMimeType
            ? [
                {
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: imageMimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                    data: imageBase64,
                  },
                },
              ]
            : []),
        ],
      },
    ],
  })

  const content = response.content[0]
  if (content.type !== 'text') {
    throw new Error('Unexpected response type')
  }

  const text = content.text

  // Parse the response
  const explanationMatch = text.match(/EXPLANATION:\s*([\s\S]*?)(?=\nHTML:|$)/)
  const htmlMatch = text.match(/HTML:\s*\n?([\s\S]*)$/)

  let explanation = explanationMatch ? explanationMatch[1].trim() : 'Changes applied.'
  let html = htmlMatch ? htmlMatch[1].trim() : currentHtml

  // Strip markdown if present
  if (html.startsWith('```')) {
    html = html.replace(/^```(?:html)?\n?/, '').replace(/\n?```$/, '')
  }

  return {
    html,
    message: explanation,
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  }
}
