import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export const MODEL = 'claude-sonnet-4-6'

/** High quality model for cloning */
export const CLONE_MODEL = 'claude-sonnet-4-6'

/**
 * Strip visually irrelevant content from scraped HTML before sending to Claude.
 * Reduces token usage by 80–90% while preserving all structure needed to
 * reconstruct the visual design.
 */
export function preprocessHtmlForClone(html: string, maxChars = 12000): string {
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
 * Classify an image URL + alt text into a semantic uppercase token base.
 * The caller appends a numeric suffix for duplicates within the same category.
 */
function categorizeImageUrl(src: string, alt: string): string {
  const filename = (src.split('/').pop()?.split('?')[0] ?? '').toLowerCase()
  const combined = filename + ' ' + alt.toLowerCase()

  // Press / media brand logos — named so Claude places them in the press section
  const PRESS_BRANDS = [
    'forbes', 'billboard', 'cosmopolitan', 'vogue', 'allure', 'glamour',
    'nylon', 'refinery29', 'buzzfeed', 'elle', 'harpersbazaar', 'marieclaire',
    'people', 'instyle', 'popsugar', 'byrdie', 'wwd', 'beautyindependent',
    'whowhowhat', 'sheknows', 'into_the_gloss', 'teenvogue',
  ]
  for (const brand of PRESS_BRANDS) {
    if (combined.includes(brand)) {
      return `PRESS_LOGO_${brand.replace(/[^a-z0-9]/g, '').toUpperCase()}`
    }
  }
  if (/press[-_]logo|media[-_]logo|publication|magazine|editorial/.test(combined)) {
    return 'PRESS_LOGO'
  }

  // Site / brand logo
  if (/\blogo\b/.test(combined)) return 'LOGO_IMAGE'

  // Hero / banner
  if (/\bhero\b|banner|main[-_](?:image|photo|banner)|homepage[-_]banner/.test(combined)) {
    return 'HERO_IMAGE'
  }

  // Named product-section patterns (common e-commerce / beauty brands)
  if (/sensitiv/.test(combined)) return 'SENSITIVE_SECTION_IMAGE'
  if (/ritual|routine|regimen/.test(combined)) return 'RITUAL_IMAGE'
  if (/purple|lavender|violet/.test(combined)) return 'PURPLE_COLLECTION_IMAGE'
  if (/teeth|tooth|whitening|dental/.test(combined)) return 'TEETH_IMAGE'
  if (/before[-_]after|result/.test(combined)) return 'BEFORE_AFTER_IMAGE'

  // Person / model / portrait → lifestyle / hero area
  if (/portrait|lifestyle|model|person|woman|face/.test(combined)) return 'LIFESTYLE_IMAGE'

  // Generic product images
  if (/product|item|sku|variant|pdp|shop/.test(combined)) return 'PRODUCT_IMAGE'

  // Icons / badges
  if (/\bicon\b|badge|seal|award|cert/.test(combined)) return 'ICON'

  // Catch-all
  return 'IMAGE'
}

/**
 * Build a semantic image map from scraped HTML.
 *
 * Each <img> is assigned a descriptive token (e.g. HERO_IMAGE, PRODUCT_IMAGE_1,
 * PRESS_LOGO_FORBES) so Claude knows which section each image belongs to,
 * rather than a blind IMAGE_1 / IMAGE_2 ordering.
 *
 * Returns:
 *   tokenToUrl  – Map<token, realUrl> for post-generation substitution
 *   promptBlock – formatted string to embed in the Claude user prompt
 */
export function buildImageMap(html: string): {
  tokenToUrl: Map<string, string>
  promptBlock: string
} {
  const categoryCount = new Map<string, number>()
  const tokenToUrl = new Map<string, string>()
  const orderedTokens: string[] = []
  const seenUrls = new Set<string>()

  const imgRe = /<img\b([^>]*)>/gi
  let m: RegExpExecArray | null
  while ((m = imgRe.exec(html)) !== null) {
    const attrs = m[1]
    const srcMatch = attrs.match(/\bsrc=(?:"([^"]*)"|'([^']*)'|([^\s>/]+))/)
    const src = (srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '') : '').trim()
    if (!src || src.startsWith('data:')) continue
    if (seenUrls.has(src)) continue
    seenUrls.add(src)

    const altMatch = attrs.match(/\balt=(?:"([^"]*)"|'([^']*)'|([^\s>/]+))/)
    const alt = (altMatch ? (altMatch[1] ?? altMatch[2] ?? altMatch[3] ?? '') : '').trim()

    const base = categorizeImageUrl(src, alt)

    // Press logos with embedded brand name are unique by definition
    let token: string
    if (base.startsWith('PRESS_LOGO_') && base.length > 'PRESS_LOGO_'.length) {
      token = base
      if (tokenToUrl.has(token)) continue // skip duplicate brand variant
    } else {
      const count = (categoryCount.get(base) ?? 0) + 1
      categoryCount.set(base, count)
      token = count === 1 ? base : `${base}_${count}`
    }

    tokenToUrl.set(token, src)
    orderedTokens.push(token)
  }

  if (tokenToUrl.size === 0) return { tokenToUrl, promptBlock: '' }

  const lines = orderedTokens.map((token) => `  ${token}: ${tokenToUrl.get(token)}`)
  const promptBlock = `Image Map — use these EXACT token names as <img src="..."> values:\n${lines.join('\n')}`

  return { tokenToUrl, promptBlock }
}

/**
 * After Claude generates HTML, replace semantic image tokens with real URLs.
 * Falls through to SVG / div / card injection for any images Claude didn't place.
 */
export function injectImageUrls(claudeHtml: string, tokenToUrl: Map<string, string>): string {
  if (tokenToUrl.size === 0) return claudeHtml
  let result = claudeHtml

  // ── Pass 1: Named token replacement ──────────────────────────────────────
  // Replace every known token (and legacy IMAGE_N if Claude fell back to numbers).
  const used = new Set<string>()
  const allTokens = [...tokenToUrl.keys()]
  const srcsInOrder = [...tokenToUrl.values()]

  if (allTokens.length > 0) {
    const escaped = allTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const pattern = new RegExp(`\\b(${escaped.join('|')}|IMAGE_\\d+)\\b`, 'g')

    result = result.replace(pattern, (match) => {
      if (tokenToUrl.has(match)) {
        used.add(match)
        return tokenToUrl.get(match)!
      }
      // Legacy IMAGE_N fallback
      const nMatch = match.match(/^IMAGE_(\d+)$/)
      if (nMatch) {
        const idx = parseInt(nMatch[1], 10) - 1
        if (idx >= 0 && idx < srcsInOrder.length) return srcsInOrder[idx]
      }
      return match
    })
  }

  // Remaining URLs not yet placed
  let pool = [...tokenToUrl.entries()]
    .filter(([token]) => !used.has(token))
    .map(([, src]) => src)

  // ── Pass 2: SVG placeholder replacement ───────────────────────────────────
  if (pool.length > 0) {
    let i = 0
    result = result.replace(/<svg\b(?![^>]*\b(?:title|aria-label)\b)[^>]*>[\s\S]*?<\/svg>/gi, (svgTag) => {
      if (i >= pool.length) return svgTag
      if (/<(?:rect|circle|polygon)\b/i.test(svgTag)) {
        return `<img src="${pool[i++]}" style="width:100%;height:100%;object-fit:cover;">`
      }
      return svgTag
    })
    pool = pool.slice(i)
  }

  // ── Pass 3: Empty image-class div injection ────────────────────────────────
  if (pool.length > 0) {
    let i = 0
    result = result.replace(
      /<div\b([^>]*\bclass=["'][^"']*\b(?:image|photo|thumb|picture|img)\b[^"']*["'][^>]*)>([\s\S]*?)<\/div>/gi,
      (match, attrs, inner) => {
        if (/<img\b/i.test(inner) || i >= pool.length) return match
        return `<div${attrs}><img src="${pool[i++]}" style="width:100%;height:100%;object-fit:cover;">${inner}</div>`
      }
    )
    pool = pool.slice(i)
  }

  // ── Pass 4: Product-card injection (broadest fallback) ────────────────────
  if (pool.length > 0) {
    let i = 0
    result = result.replace(
      /<(div|article|li)\b([^>]*)>/gi,
      (match, _tag, attrs, offset: number, str: string) => {
        if (i >= pool.length) return match
        const classMatch = attrs.match(/\bclass=["']([^"']*)["']/)
        if (!classMatch) return match
        const cls = classMatch[1].toLowerCase()
        if (!/\b(?:product|card|item|tile|thumb|result|entry)\b/.test(cls)) return match
        if (/\b(?:grid|list|container|wrapper|wrap|row|header|footer|nav|menu|sidebar)\b/.test(cls)) return match
        const lookahead = str.slice(offset + match.length, offset + match.length + 2500)
        if (/<img\b/i.test(lookahead)) return match
        return `${match}<img src="${pool[i++]}" style="width:100%;aspect-ratio:1;object-fit:cover;">`
      }
    )
  }

  // ── Final cleanup ──────────────────────────────────────────────────────────
  // Strip any leftover numeric IMAGE_N tokens
  result = result.replace(/<img\b[^>]*\bsrc=["']IMAGE_\d+["'][^>]*>/gi, '')
  result = result.replace(/\bIMAGE_\d+\b/g, '')
  // Strip any named tokens Claude didn't use (prevents token text leaking into page)
  if (allTokens.length > 0) {
    const escaped = allTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const cleanPattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'g')
    result = result.replace(cleanPattern, '')
  }

  return result
}

/**
 * Extract h1–h3 headings from scraped HTML as a structured section list to
 * give Claude a "table of contents" so it doesn't skip any page sections.
 */
function extractPageSections(html: string): string {
  const texts: string[] = []
  const re = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (text.length > 1 && text.length < 120 && !texts.includes(text)) texts.push(text)
    if (texts.length >= 25) break
  }
  return texts.length > 0
    ? `Page sections (headings found in HTML):\n${texts.map((t) => `• ${t}`).join('\n')}`
    : ''
}

function buildCloneSystemPrompt(hasImages: boolean): string {
  const imageRules = hasImages
    ? `IMAGES — read carefully, this is critical:
- An Image Map is included in the user message. It lists token names and their exact URLs.
- For every image visible in the screenshot, find the matching token in the Image Map and output <img src="TOKEN_NAME">
- Place each token in the section that matches its name:
  • HERO_IMAGE → hero / header section
  • LOGO_IMAGE → site logo in navigation or header
  • PRODUCT_IMAGE, PRODUCT_IMAGE_N → product grid / product card sections
  • PRESS_LOGO_N, PRESS_LOGO_BRANDNAME → press / media / "as seen in" section only
  • SENSITIVE_SECTION_IMAGE → sensitive-formula / sensitive-skin product section
  • RITUAL_IMAGE → beauty ritual / daily routine section
  • PURPLE_COLLECTION_IMAGE → purple collection / purple product section
  • TEETH_IMAGE → teeth whitening / dental product section
  • BEFORE_AFTER_IMAGE → before & after / results section
  • LIFESTYLE_IMAGE → lifestyle photography / model imagery areas
  • ICON, ICON_N → icon, badge, or award areas
  • IMAGE, IMAGE_N → general content image — place contextually based on surrounding content
- Use the EXACT token string as the src value: <img src="HERO_IMAGE">, <img src="PRODUCT_IMAGE_1">, etc.
- Every token in the Image Map MUST appear exactly once in your HTML output
- Never use data: URIs, picsum.photos, placehold.it, or any placeholder image service
- Never use SVG shapes or empty divs where a real image should appear`
    : `IMAGES — no real image URLs are available for this page:
- Do NOT output any <img> tags at all
- Do NOT use broken src values, placeholder services, or data: URIs
- Instead, wherever a product/content image appears in the screenshot, render a styled <div> placeholder:
  - Match the approximate size and position from the screenshot
  - Fill it with the product name or a short description as centered text
  - Use a background colour that matches the dominant colour of that image area in the screenshot
  - Style: display:flex; align-items:center; justify-content:center; font-size:0.85rem; color:#555; border-radius matching the screenshot`

  return `You are a web developer. Recreate this page EXACTLY as shown in the screenshot.
- Output ONLY raw HTML — no markdown, no code fences, no explanation
- Start your response with <!DOCTYPE html> and end with </html>
- Inline all CSS in a <style> tag in <head>
- Reconstruct this page EXACTLY as shown in the screenshot. Match every section, every image placement, every color, every font size. Do not skip or abbreviate any section.
- EVERY section visible in the screenshot MUST appear in your output — hero, navigation, product grids, feature sections, testimonials, press logos, footers, etc.
- Match colors with pixel-perfect accuracy — sample exact hex values from the screenshot
- Match font sizes, weights, and spacing as closely as possible
- Make it responsive with modern CSS (flexbox, grid)
- Include Google Fonts CDN link if web fonts are used
- No JavaScript unless essential
- An HTML structure extract is provided alongside the screenshot — use it to capture exact text, class names, and content order
${imageRules}`
}

function buildCloneUserPrompt(
  url: string,
  imagePromptBlock: string,
  pageSections: string,
  structuredHtml: string
): string {
  return `Recreate this website (${url}) as a complete, self-contained HTML file.

${imagePromptBlock
    ? `${imagePromptBlock}\n\nUse the EXACT token names as <img src="TOKEN"> values. Place each in the section matching its name.`
    : 'No real image URLs are available — use styled placeholder divs instead of <img> tags as instructed.'}

${pageSections ? `${pageSections}\n\nYou MUST include ALL of the above sections in your output. Do not skip any.` : ''}

${structuredHtml ? `HTML structure for reference — use this to capture exact text content, section order, and layout:\n\`\`\`html\n${structuredHtml}\n\`\`\`` : ''}

Reconstruct the COMPLETE page EXACTLY as shown in the screenshot. Every section, every color, every font size must match. Do not truncate or omit any part of the page.`
}

export async function generateClone(
  htmlContent: string,
  screenshotBase64: string,
  url: string
): Promise<{ html: string; tokensUsed: number }> {
  const { tokenToUrl, promptBlock } = buildImageMap(htmlContent)
  const pageSections = extractPageSections(htmlContent)
  const structuredHtml = preprocessHtmlForClone(htmlContent)

  const response = await anthropic.messages.create({
    model: CLONE_MODEL,
    max_tokens: 8000,
    system: buildCloneSystemPrompt(tokenToUrl.size > 0),
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
            text: buildCloneUserPrompt(url, promptBlock, pageSections, structuredHtml),
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
    html: injectImageUrls(claudeHtml, tokenToUrl),
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
): Promise<{ html: string; tokensUsed: number; tokenToUrl: Map<string, string> }> {
  const SAVE_INTERVAL = 2000 // chars between DB saves

  const { tokenToUrl, promptBlock } = buildImageMap(htmlContent)
  const pageSections = extractPageSections(htmlContent)
  const structuredHtml = preprocessHtmlForClone(htmlContent)

  const stream = await anthropic.messages.create({
    model: CLONE_MODEL,
    max_tokens: 8000,
    stream: true,
    system: buildCloneSystemPrompt(tokenToUrl.size > 0),
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
            text: buildCloneUserPrompt(url, promptBlock, pageSections, structuredHtml),
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
    // html has tokens replaced; tokenToUrl is returned so the caller can
    // independently call injectImageUrls() before any DB save, ensuring
    // the persisted HTML always contains real URLs — not token names.
    html: injectImageUrls(claudeHtml, tokenToUrl),
    tokensUsed: inputTokens + outputTokens,
    tokenToUrl,
  }
}

// Chat edit: asks Haiku for a JSON array of CSS changes, applies them as a
// <style data-chat-edit> block. The full HTML is never sent to Claude and is
// always preserved exactly — only the style block changes.
export async function chatWithProjectStreaming(
  currentHtml: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onPartialHtml: (partialHtml: string) => void,
  imageBase64?: string,
  imageMimeType?: string
): Promise<{ html: string; message: string; tokensUsed: number }> {
  const lastUserMessage = messages[messages.length - 1]

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: `You are a website editor. The user will describe a change they want to make to their website. Return ONLY a valid JSON array with no explanation, no markdown, no code blocks. Each item in the array must be one of these two types:

CSS change: {"type": "css", "selector": "string", "property": "string", "value": "string"}
Text change: {"type": "text", "search": "exact string to find", "replace": "replacement string"}

Rules:
- For color, font, size, spacing, visibility changes use type css
- For changing words, labels, headings, button text, any content changes use type text
- For the search field in text changes, use the shortest unique string that identifies the text, do not include surrounding HTML tags
- If a request needs both CSS and text changes return both types in the same array
- If you cannot make the change return []
- Never return anything except the JSON array`,
    messages: [
      {
        role: 'user',
        content: lastUserMessage.content,
      },
    ],
  })

  const content = response.content[0]
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens
  const raw = content.type === 'text' ? content.text.trim() : ''

  type CssChange = { type: 'css'; selector: string; property: string; value: string }
  type TextChange = { type: 'text'; search: string; replace: string }
  type Change = CssChange | TextChange

  let changes: Change[] = []
  try {
    const jsonText = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```\s*$/, '')
    const parsed = JSON.parse(jsonText)
    if (Array.isArray(parsed)) changes = parsed
  } catch {
    return {
      html: currentHtml,
      message: 'That change could not be made. Please try a different request.',
      tokensUsed,
    }
  }

  if (changes.length === 0) {
    return {
      html: currentHtml,
      message: 'That change could not be made. Please try a different request.',
      tokensUsed,
    }
  }

  // Apply text changes directly to the HTML
  let updatedHtml = currentHtml
  for (const item of changes) {
    if (item.type === 'text' && item.search && item.replace !== undefined) {
      updatedHtml = updatedHtml.split(item.search).join(item.replace)
    }
  }

  // Strip any previous chat-edit block, then inject the new one
  updatedHtml = updatedHtml.replace(/<style data-chat-edit>[\s\S]*?<\/style>\n?/g, '')

  const cssChanges = changes.filter((c): c is CssChange => c.type === 'css' && !!c.selector && !!c.property && !!c.value)
  if (cssChanges.length > 0) {
    const cssRules = cssChanges
      .map((c) => `  ${c.selector} { ${c.property}: ${c.value} !important; }`)
      .join('\n')

    const styleBlock = `<style data-chat-edit>\n${cssRules}\n</style>`

    if (/<\/head>/i.test(updatedHtml)) {
      updatedHtml = updatedHtml.replace(/<\/head>/i, `${styleBlock}\n</head>`)
    } else if (/<body/i.test(updatedHtml)) {
      updatedHtml = updatedHtml.replace(/<body/i, `${styleBlock}\n<body`)
    } else {
      updatedHtml = styleBlock + '\n' + updatedHtml
    }
  }

  onPartialHtml(updatedHtml)

  return {
    html: updatedHtml,
    message: 'Changes applied.',
    tokensUsed,
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
    max_tokens: 6000,
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
