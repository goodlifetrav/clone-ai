import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export const MODEL = 'claude-sonnet-4-6'

/** Cheap fast model for initial cloning — 20× cheaper than sonnet */
export const CLONE_MODEL = 'claude-haiku-4-5-20251001'

/**
 * Strip visually irrelevant content from scraped HTML before sending to Claude.
 * Reduces token usage by 80–90% while preserving all structure needed to
 * reconstruct the visual design.
 */
export function preprocessHtmlForClone(html: string, maxChars = 6000): string {
  let result = html
  // Remove scripts and their content
  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  // Remove HTML comments
  result = result.replace(/<!--[\s\S]*?-->/g, '')
  // Remove noscript blocks
  result = result.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
  // Remove decorative SVGs (those without a title or aria-label attribute)
  result = result.replace(/<svg\b(?![^>]*\b(?:title|aria-label)\b)[^>]*>[\s\S]*?<\/svg>/gi, '')
  // Self-closing decorative SVGs
  result = result.replace(/<svg\b(?![^>]*\b(?:title|aria-label)\b)[^>]*\/>/gi, '')
  // Strip all attributes from tags except the allowlist
  const ALLOWED_ATTRS = new Set(['src', 'href', 'srcset', 'class', 'id', 'style', 'rel', 'type'])
  result = result.replace(/<([a-z][a-z0-9-]*)(\s[^>]*)?(\/?)>/gi, (_m, tag: string, attrStr: string | undefined, selfClose: string) => {
    if (!attrStr) return `<${tag}${selfClose}>`
    const attrs = attrStr.match(/\b([a-z][a-z0-9:-]*)=(?:"[^"]*"|'[^']*'|[^\s>/]+)/gi) ?? []
    const kept = attrs.filter((a) => ALLOWED_ATTRS.has(a.split('=')[0].toLowerCase().trim()))
    return `<${tag}${kept.length ? ' ' + kept.join(' ') : ''}${selfClose}>`
  })
  // Collapse whitespace
  result = result.replace(/\s+/g, ' ').trim()
  // Truncate to budget
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) + '…'
  }
  return result
}

/** Strip markdown code fences that Claude sometimes wraps around HTML output */
function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:html|HTML)?\n?/, '')
    .replace(/\n?```\s*$/, '')
}

export async function generateClone(
  htmlContent: string,
  screenshotBase64: string,
  url: string
): Promise<{ html: string; tokensUsed: number }> {
  const response = await anthropic.messages.create({
    model: CLONE_MODEL,
    max_tokens: 3000,
    system: `You are a web developer. Recreate the screenshot as a complete self-contained HTML file.
- Output ONLY raw HTML — no markdown, no code fences, no explanation
- Start your response with <!DOCTYPE html> and end with </html>
- Inline all CSS in a <style> tag in <head>
- Match the visual design exactly: colors, fonts, layout, spacing, content
- Make it responsive with modern CSS (flexbox, grid)
- Include Google Fonts CDN link if web fonts are used
- IMPORTANT: Use the exact image src URLs from the original HTML — never replace with placeholders
- No JavaScript unless essential`,
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
${preprocessHtmlForClone(htmlContent)}
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

  const raw = stripMarkdownFences(content.text.trim())

  // Extract the HTML document from <!DOCTYPE or <html to </html>
  const htmlMatch =
    raw.match(/<!DOCTYPE\s+html[\s\S]*<\/html>/i) ??
    raw.match(/<html[\s\S]*<\/html>/i)

  const html = htmlMatch ? htmlMatch[0] : raw
  if (!html) throw new Error('Claude returned empty HTML — please try again')

  return {
    html,
    tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
  }
}

// Same as generateClone but streams partial HTML via callbacks:
//   onPartialHtml – throttled DB save (every SAVE_INTERVAL chars)
//   onDelta       – fired on every single Claude delta for real-time UI streaming
export async function generateCloneStreaming(
  htmlContent: string,
  screenshotBase64: string,
  url: string,
  onPartialHtml: (partialText: string) => Promise<void>,
  onDelta?: (accumulated: string) => void
): Promise<{ html: string; tokensUsed: number }> {
  const SAVE_INTERVAL = 2000 // chars between DB saves

  const stream = await anthropic.messages.create({
    model: CLONE_MODEL,
    max_tokens: 3000,
    stream: true,
    system: `You are a web developer. Recreate the screenshot as a complete self-contained HTML file.
- Output ONLY raw HTML — no markdown, no code fences, no explanation
- Start your response with <!DOCTYPE html> and end with </html>
- Inline all CSS in a <style> tag in <head>
- Match the visual design exactly: colors, fonts, layout, spacing, content
- Make it responsive with modern CSS (flexbox, grid)
- Include Google Fonts CDN link if web fonts are used
- IMPORTANT: Use the exact image src URLs from the original HTML — never replace with placeholders
- No JavaScript unless essential`,
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
${preprocessHtmlForClone(htmlContent)}
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
      // Fire on every delta for real-time UI streaming (no throttle)
      // Strip markdown fences so the code editor always shows clean HTML
      onDelta?.(stripMarkdownFences(accumulated))
      // Throttled DB save
      if (accumulated.length - lastSaveLength >= SAVE_INTERVAL) {
        lastSaveLength = accumulated.length
        await onPartialHtml(accumulated)
      }
    } else if (event.type === 'message_delta') {
      outputTokens = event.usage.output_tokens
    }
  }

  const clean = stripMarkdownFences(accumulated.trim())

  const htmlMatch =
    clean.match(/<!DOCTYPE\s+html[\s\S]*<\/html>/i) ??
    clean.match(/<html[\s\S]*<\/html>/i)

  const html = htmlMatch ? htmlMatch[0] : clean
  if (!html) throw new Error('Claude returned empty HTML — please try again')

  return {
    html,
    tokensUsed: inputTokens + outputTokens,
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
  // Truncate HTML sent to Claude to reduce input token costs.
  // 15 000 chars ≈ 3 000–4 000 tokens — enough for meaningful edits.
  const MAX_HTML_CHARS = 15000
  const htmlForClaude =
    currentHtml.length > MAX_HTML_CHARS
      ? currentHtml.slice(0, MAX_HTML_CHARS) + '\n<!-- [HTML truncated] -->'
      : currentHtml

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
    text: `Here is the current HTML of the website:\n\`\`\`html\n${htmlForClaude}\n\`\`\`\n\n${lastUserMessage.content}`,
  })

  const stream = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
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
    max_tokens: 4000,
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
