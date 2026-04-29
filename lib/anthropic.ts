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

/**
 * Replace every <img src="..."> in the HTML with <img src="IMAGE_N"> placeholders
 * (1-indexed, in DOM order).  Returns the modified HTML and the original src list so
 * we can inject real URLs back after Claude generates the clone.
 *
 * This prevents Claude from ignoring or mangling image URLs — it only ever sees
 * simple tokens like IMAGE_1, IMAGE_2, which it faithfully copies through.
 */
export function extractAndNumberImages(html: string): { html: string; srcs: string[] } {
  const srcs: string[] = []
  const result = html.replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
    const srcMatch = attrs.match(/\bsrc=(?:"([^"]*)"|'([^']*)'|([^\s>/]+))/)
    const src = (srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '') : '').trim()
    if (!src) return '<img>'
    if (!srcs.includes(src)) srcs.push(src)
    const n = srcs.indexOf(src) + 1
    const altMatch = attrs.match(/\balt=(?:"([^"]*)"|'([^']*)'|([^\s>/]+))/)
    const altVal = altMatch ? (altMatch[1] ?? altMatch[2] ?? altMatch[3] ?? '') : ''
    return `<img src="IMAGE_${n}"${altVal ? ` alt="${altVal}"` : ''}>`
  })
  return { html: result, srcs }
}

/**
 * After Claude generates HTML:
 *  1. Replace IMAGE_N tokens with the real src URLs.
 *  2. Replace any decorative SVG placeholder shapes (rect/circle/path with no
 *     title/aria-label) with <img> tags using the still-unused image URLs.
 *     This is the fallback for when Claude generates SVGs instead of <img> tags.
 */
export function injectImageUrls(claudeHtml: string, srcs: string[]): string {
  if (srcs.length === 0) return claudeHtml
  let result = claudeHtml

  // 1 — replace IMAGE_N placeholders
  const used = new Set<number>()
  result = result.replace(/IMAGE_(\d+)/g, (match, n) => {
    const idx = parseInt(n, 10) - 1
    if (idx >= 0 && idx < srcs.length) {
      used.add(idx)
      return srcs[idx]
    }
    return match
  })

  // 2 — replace decorative SVGs with unused image URLs (SVG-placeholder fallback)
  let unusedSrcs = srcs.filter((_, i) => !used.has(i))

  if (unusedSrcs.length > 0) {
    let unusedIdx = 0
    result = result.replace(/<svg\b(?![^>]*\b(?:title|aria-label)\b)[^>]*>[\s\S]*?<\/svg>/gi, (svgTag) => {
      if (unusedIdx >= unusedSrcs.length) return svgTag
      // Only swap out SVGs that contain basic placeholder shapes, not icon paths
      if (/<(?:rect|circle|polygon)\b/i.test(svgTag)) {
        return `<img src="${unusedSrcs[unusedIdx++]}" style="width:100%;height:100%;object-fit:cover;">`
      }
      return svgTag
    })
    // Recompute unused after SVG pass
    const svgUsed = unusedIdx
    unusedSrcs = unusedSrcs.slice(svgUsed)
  }

  // 3 — fill empty image-container divs with unused image URLs
  // Matches divs whose class contains image/photo/thumb/picture/img and have no <img> child.
  if (unusedSrcs.length > 0) {
    let unusedIdx = 0
    // IMAGE_CONTAINER_KEYWORDS covers common class naming patterns for product/media images
    const containerPattern = /<div\b([^>]*\bclass=(?:"[^"]*\b(?:image|photo|thumb|picture|img)\b[^"]*"|'[^']*\b(?:image|photo|thumb|picture|img)\b[^']*')[^>]*)>([\s\S]*?)<\/div>/gi
    result = result.replace(containerPattern, (match, attrs, inner) => {
      // Skip if it already contains an <img> tag
      if (/<img\b/i.test(inner)) return match
      if (unusedIdx >= unusedSrcs.length) return match
      const src = unusedSrcs[unusedIdx++]
      return `<div${attrs}><img src="${src}" style="width:100%;height:100%;object-fit:cover;">${inner}</div>`
    })
  }

  return result
}

function buildCloneSystemPrompt(): string {
  return `You are a web developer. Recreate the screenshot as a complete self-contained HTML file.
- Output ONLY raw HTML — no markdown, no code fences, no explanation
- Start your response with <!DOCTYPE html> and end with </html>
- Inline all CSS in a <style> tag in <head>
- Match the visual design exactly: colors, fonts, layout, spacing, content
- Make it responsive with modern CSS (flexbox, grid)
- Include Google Fonts CDN link if web fonts are used
- No JavaScript unless essential
IMAGES — this is critical, read carefully:
- The source HTML uses IMAGE_1, IMAGE_2, IMAGE_3 … as placeholders for real images
- You MUST output <img src="IMAGE_1">, <img src="IMAGE_2">, etc. — copy these tokens exactly
- For every product image, you MUST output an actual <img src="IMAGE_N"> HTML tag inside the container div. Never use empty divs or CSS backgrounds for product images.
- You MUST NOT generate <svg> shapes, rectangles, circles, or paths to represent images
- You MUST NOT leave image container divs empty — every div with class containing "image", "photo", "thumb", "picture" MUST contain an <img> tag
- You MUST NOT use data: URIs for images
- You MUST NOT invent URLs or use placeholder image services (picsum, placehold.it, etc.)
- Every image visible in the screenshot MUST appear as an <img src="IMAGE_N"> tag`
}

function buildCloneUserPrompt(url: string, processedHtml: string, imageCount: number): string {
  return `Recreate this website (${url}) as a complete, self-contained HTML file.

${imageCount > 0 ? `This page has ${imageCount} image${imageCount > 1 ? 's' : ''} (IMAGE_1${imageCount > 1 ? ` through IMAGE_${imageCount}` : ''}). Each one MUST appear as an <img src="IMAGE_N"> tag — no SVGs, no placeholders.` : ''}

Original HTML structure for reference (images replaced with IMAGE_N tokens):
${processedHtml}`
}

export async function generateClone(
  htmlContent: string,
  screenshotBase64: string,
  url: string
): Promise<{ html: string; tokensUsed: number }> {
  // Number images before preprocessing so Claude only sees IMAGE_N tokens
  const { html: numberedHtml, srcs } = extractAndNumberImages(htmlContent)
  const processedHtml = preprocessHtmlForClone(numberedHtml)

  const response = await anthropic.messages.create({
    model: CLONE_MODEL,
    max_tokens: 3000,
    system: buildCloneSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 },
          },
          {
            type: 'text',
            text: buildCloneUserPrompt(url, processedHtml, srcs.length),
          },
        ],
      },
    ],
  })

  const content = response.content[0]
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude')

  const raw = stripMarkdownFences(content.text.trim())
  const htmlMatch =
    raw.match(/<!DOCTYPE\s+html[\s\S]*<\/html>/i) ??
    raw.match(/<html[\s\S]*<\/html>/i)
  const claudeHtml = htmlMatch ? htmlMatch[0] : raw
  if (!claudeHtml) throw new Error('Claude returned empty HTML — please try again')

  return {
    html: injectImageUrls(claudeHtml, srcs),
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

  // Number images before preprocessing so Claude only sees IMAGE_N tokens
  const { html: numberedHtml, srcs } = extractAndNumberImages(htmlContent)
  const processedHtml = preprocessHtmlForClone(numberedHtml)

  const stream = await anthropic.messages.create({
    model: CLONE_MODEL,
    max_tokens: 3000,
    stream: true,
    system: buildCloneSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 },
          },
          {
            type: 'text',
            text: buildCloneUserPrompt(url, processedHtml, srcs.length),
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

  const claudeHtml = htmlMatch ? htmlMatch[0] : clean
  if (!claudeHtml) throw new Error('Claude returned empty HTML — please try again')

  return {
    html: injectImageUrls(claudeHtml, srcs),
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
