/**
 * shopify-sectioner — converts a static HTML clone into Shopify liquid sections
 *
 * Architecture:
 * - layout/theme.liquid references {% section 'igualai-header' %} and {% section 'igualai-footer' %}
 *   These are "static sections" — they appear in EVERY page's editor and support {% schema %}
 * - Body content becomes template sections referenced from templates/index.json
 * - All sections have proper {% schema %} blocks with editable settings wired to the HTML
 */

import { load, type CheerioAPI } from 'cheerio'

export interface ShopifySections {
  sections: Record<string, string>   // section name → liquid file content
  order: string[]                     // order for templates/index.json
  headerSectionName: string           // always 'igualai-header'
  footerSectionName: string           // always 'igualai-footer'
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function schemaTag(obj: object): string {
  return `\n{% schema %}\n${JSON.stringify(obj, null, 2)}\n{% endschema %}`
}

/** Only add `default` key if value is non-empty — Shopify rejects empty string defaults */
function setting(base: object, defaultVal?: string): object {
  if (!defaultVal || defaultVal.trim() === '') return base
  return { ...base, default: defaultVal.trim().slice(0, 255) }
}

function bodyHtml($: CheerioAPI): string {
  return $('body').html() ?? ''
}

/** Count visual "images" — both <img> tags and CSS background-image/gradient URLs */
function countImages(html: string): number {
  const imgTags = (html.match(/<img[\s>]/gi) ?? []).length
  const bgImages = (html.match(/url\(["']?https?:/gi) ?? []).length
  const gradients = (html.match(/linear-gradient|radial-gradient/gi) ?? []).length
  // Count each gradient separately — 6 card gradients = 6 visual "images"
  return imgTags + bgImages + gradients
}

/** Count repeated card-like children (for detecting product/content grids) */
function countCardChildren($el: ReturnType<CheerioAPI>): number {
  const children = $el.children().toArray()
  if (children.length < 3) return 0
  // If 3+ children of similar tag, likely a card grid
  const tags = children.map(c => (c as { tagName?: string }).tagName ?? '')
  const mostCommon = tags.sort().reduce((a, b, _, arr) =>
    arr.filter(v => v === a).length >= arr.filter(v => v === b).length ? a : b, tags[0])
  return tags.filter(t => t === mostCommon).length
}

// ── Classifiers ─────────────────────────────────────────────────────────────

function classifySection(html: string, isFirst: boolean): string {
  const lower = html.toLowerCase()
  const textLen = html.replace(/<[^>]+>/g, '').trim().length
  const imgCount = countImages(html)

  // Announcement bar: very short text content
  if (textLen < 200 && (
    lower.includes('free shipping') || lower.includes('% off') || lower.includes('new arrivals') ||
    lower.includes('limited time') || lower.includes('today only') ||
    (isFirst && textLen < 120 && !lower.includes('<nav'))
  )) return 'announcement-bar'

  // Hero: has a large heading + CTA button
  if (
    (lower.includes('<h1') || lower.includes('hero') || lower.includes('banner')) &&
    (lower.includes('btn') || lower.includes('button') || (lower.includes('<a ') && lower.includes('href')))
  ) return 'hero'

  // Product / content grid: multiple images or card children
  if (imgCount >= 3) {
    const keywords = ['product', 'shop', 'collection', 'price', '$', 'fragrance', 'scent',
                      'cologne', 'grooming', 'item', 'card', 'grid', 'mosaic', 'buy']
    if (keywords.some(k => lower.includes(k)) || imgCount >= 4) return 'product-grid'
  }

  // Testimonials
  if (lower.includes('review') || lower.includes('testimonial') || lower.includes('★')) return 'testimonials'

  // Features / icon grid
  if (lower.includes('feature') || (lower.includes('<h2') && lower.includes('<h3'))) return 'features'

  // Lifestyle / brand story
  if (imgCount >= 1 && (lower.includes('story') || lower.includes('about') || lower.includes('mission') ||
      lower.includes('values') || lower.includes('lifestyle') || lower.includes('brotherhood'))) return 'lifestyle'

  return 'content'
}

// ── Schema builders ──────────────────────────────────────────────────────────

function buildHeroSchema(d: Record<string, string>) {
  return {
    name: 'Hero',
    settings: [
      setting({ type: 'text', id: 'heading', label: 'Heading' }, d.heading),
      setting({ type: 'textarea', id: 'subheading', label: 'Subheading' }, d.subheading),
      setting({ type: 'text', id: 'btn1_label', label: 'Button 1 text' }, d.btn1_label),
      { type: 'url', id: 'btn1_url', label: 'Button 1 URL' },
      setting({ type: 'text', id: 'btn2_label', label: 'Button 2 text' }, d.btn2_label),
      { type: 'url', id: 'btn2_url', label: 'Button 2 URL' },
      { type: 'image_picker', id: 'bg_image', label: 'Background image' },
    ],
    presets: [{ name: 'Hero' }],
  }
}

function buildProductGridSchema(d: Record<string, string>) {
  return {
    name: 'Product Grid',
    settings: [
      setting({ type: 'text', id: 'heading', label: 'Section heading' }, d.heading),
      { type: 'collection', id: 'collection', label: 'Collection (shows real products)' },
      { type: 'range', id: 'products_to_show', label: 'Products to show', min: 2, max: 12, step: 1, default: 6 },
      { type: 'range', id: 'columns', label: 'Columns', min: 2, max: 4, step: 1, default: 3 },
      { type: 'checkbox', id: 'show_price', label: 'Show price', default: true },
    ],
    presets: [{ name: 'Product Grid' }],
  }
}

function buildContentSchema(name: string, d: Record<string, string>, hasImages: boolean) {
  return {
    name,
    settings: [
      setting({ type: 'text', id: 'heading', label: 'Heading' }, d.heading),
      setting({ type: 'textarea', id: 'subheading', label: 'Subheading' }, d.subheading),
      ...(hasImages ? [{ type: 'collection', id: 'collection', label: 'Link a collection (optional)' }] : []),
      { type: 'color', id: 'bg_color', label: 'Background color', default: '#ffffff' },
    ],
    presets: [{ name }],
  }
}

function buildHeaderSchema(d: Record<string, string>) {
  return {
    name: 'Header',
    class: 'section-header',
    settings: [
      { type: 'checkbox', id: 'show_announcement', label: 'Show announcement bar', default: true },
      setting({ type: 'text', id: 'announcement_text', label: 'Announcement text' }, d.announcement_text),
      { type: 'color', id: 'announcement_bg', label: 'Announcement background', default: d.announcement_bg || '#1a5c3a' },
      { type: 'color', id: 'announcement_color', label: 'Announcement text color', default: '#ffffff' },
      { type: 'image_picker', id: 'logo', label: 'Logo image' },
      { type: 'link_list', id: 'menu', label: 'Navigation menu', default: 'main-menu' },
    ],
  }
}

function buildFooterSchema() {
  return {
    name: 'Footer',
    class: 'section-footer',
    settings: [
      { type: 'link_list', id: 'menu1', label: 'Footer links column 1', default: 'footer' },
      { type: 'link_list', id: 'menu2', label: 'Footer links column 2' },
      { type: 'text', id: 'copyright', label: 'Copyright text' },
      { type: 'color', id: 'bg_color', label: 'Background color', default: '#000000' },
      { type: 'color', id: 'text_color', label: 'Text color', default: '#ffffff' },
    ],
  }
}

// ── Liquid injection ─────────────────────────────────────────────────────────

function liquidifyHero(chunkHtml: string): { liquid: string; defaults: Record<string, string> } {
  const $ = load(chunkHtml)
  const d: Record<string, string> = {}

  const h1 = $('h1').first()
  if (h1.length) { d.heading = h1.text().trim(); h1.html('{{ section.settings.heading }}') }
  else {
    const h2 = $('h2').first()
    if (h2.length) { d.heading = h2.text().trim(); h2.html('{{ section.settings.heading }}') }
  }

  const p = $('p').first()
  if (p.length) { d.subheading = p.text().trim(); p.html('{{ section.settings.subheading }}') }

  const btns = $('a[class*="btn"], a[class*="button"], button, [class*="cta"]').toArray()
  if (btns[0]) {
    const b = $(btns[0])
    d.btn1_label = b.text().trim()
    b.html('{{ section.settings.btn1_label }}')
    if (b.attr('href')) b.attr('href', '{{ section.settings.btn1_url }}')
  }
  if (btns[1]) {
    const b = $(btns[1])
    d.btn2_label = b.text().trim()
    b.html('{{ section.settings.btn2_label }}')
    if (b.attr('href')) b.attr('href', '{{ section.settings.btn2_url }}')
  }

  return { liquid: bodyHtml($), defaults: d }
}

function liquidifyContent(chunkHtml: string): { liquid: string; defaults: Record<string, string> } {
  const $ = load(chunkHtml)
  const d: Record<string, string> = {}

  // Try heading tags first
  const h = $('h1, h2, h3').first()
  if (h.length) {
    d.heading = h.text().trim()
    h.html('{{ section.settings.heading }}')
  } else {
    // Fallback: find the first leaf element with substantial text (handles marquees, tickers, etc.)
    let replaced = false
    $('div, span, p, marquee, [class*="marquee"], [class*="ticker"], [class*="scroll"]').each((_, el) => {
      if (replaced) return false
      const $el = $(el)
      const text = $el.text().trim()
      // Only replace leaf/shallow nodes with meaningful text
      if (text.length > 5 && $el.children('div, section, article').length === 0) {
        d.heading = text.slice(0, 255)
        // For marquees that repeat text, replace ALL direct text children
        $el.contents().filter((_, n) => n.type === 'text').replaceWith('{{ section.settings.heading }}')
        if (!$el.text().includes('section.settings.heading')) {
          $el.html('{{ section.settings.heading }}')
        }
        replaced = true
      }
    })
  }

  // Subheading from first <p> (if not already used)
  if (!d.heading || d.subheading !== undefined) {
    const p = $('p').first()
    if (p.length && p.text().trim() !== d.heading) {
      d.subheading = p.text().trim()
      p.html('{{ section.settings.subheading }}')
    }
  }

  return { liquid: bodyHtml($), defaults: d }
}

// ── Product loop Liquid ──────────────────────────────────────────────────────

function productGridLiquid(heading: string): string {
  return `<div class="igualai-product-section">
  {% if section.settings.heading != blank %}
    <h2 style="text-align:center;padding:2rem 1rem 0.5rem;font-size:1.75rem;font-weight:700">
      {{ section.settings.heading }}
    </h2>
  {% endif %}
  <div style="display:grid;grid-template-columns:repeat({{ section.settings.columns }},1fr);gap:1.5rem;padding:1.5rem 2rem;max-width:1280px;margin:0 auto">
    {% assign coll = collections[section.settings.collection] %}
    {% if coll != blank %}
      {% for product in coll.products limit: section.settings.products_to_show %}
        <a href="{{ product.url }}" style="display:block;text-decoration:none;color:inherit;border-radius:12px;overflow:hidden;border:1px solid rgba(0,0,0,.08)">
          <div style="aspect-ratio:1;overflow:hidden;background:#f5f5f5">
            <img src="{{ product.featured_image | img_url: '600x600' }}" alt="{{ product.title }}" loading="lazy" style="width:100%;height:100%;object-fit:cover">
          </div>
          <div style="padding:.875rem">
            <p style="font-weight:600;margin:0 0 .25rem;font-size:.95rem">{{ product.title }}</p>
            {% if section.settings.show_price %}
              <p style="opacity:.65;margin:0;font-size:.875rem">{{ product.price | money }}</p>
            {% endif %}
          </div>
        </a>
      {% endfor %}
    {% else %}
      <div style="grid-column:1/-1;text-align:center;padding:3rem 1rem;opacity:.5;border:2px dashed #ccc;border-radius:12px">
        <p style="font-size:1rem;margin:0">Select a collection in the sidebar to show your products here.</p>
      </div>
    {% endif %}
  </div>
</div>`
}

// ── Header/Footer section builders ───────────────────────────────────────────

function buildHeaderSection(announcementHtml: string, navHtml: string): { liquid: string; defaults: Record<string, string> } {
  const d: Record<string, string> = {}

  // Extract announcement bar text for default
  if (announcementHtml) {
    const $a = load(announcementHtml)
    d.announcement_text = $a('body').text().trim().slice(0, 255)
    // Try to get background color from inline style
    const bgMatch = announcementHtml.match(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,6}|rgb[^;)"]+)/i)
    if (bgMatch) d.announcement_bg = bgMatch[1]
  }

  const announcementLiquid = announcementHtml
    ? `{% if section.settings.show_announcement %}
<div style="background-color:{{ section.settings.announcement_bg }};color:{{ section.settings.announcement_color }};text-align:center;padding:.5rem 1rem;font-size:.875rem;font-weight:500">
  {{ section.settings.announcement_text }}
</div>
{% endif %}`
    : ''

  const liquid = `${announcementLiquid}
${navHtml}
${schemaTag(buildHeaderSchema(d))}`

  return { liquid, defaults: d }
}

function buildFooterSection(footerHtml: string): string {
  // Keep original footer HTML but wrap with Liquid-controlled bg color and add schema
  return `<div style="background-color:{{ section.settings.bg_color }};color:{{ section.settings.text_color }}">
${footerHtml}
</div>
${schemaTag(buildFooterSchema())}`
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function htmlToShopifySections(html: string): Promise<ShopifySections> {
  const $ = load(html, { xmlMode: false } as never)

  // ── Extract footer ────────────────────────────────────────────────────────
  let footerHtml = ''
  const footerEl = $('footer').first()
  if (footerEl.length) { footerHtml = $.html(footerEl) ?? ''; footerEl.remove() }

  // ── Extract nav/header ────────────────────────────────────────────────────
  let navHtml = ''
  const headerEl = $('header').first()
  if (headerEl.length) { navHtml = $.html(headerEl) ?? ''; headerEl.remove() }
  else {
    const navEl = $('nav').first()
    if (navEl.length) { navHtml = $.html(navEl) ?? ''; navEl.remove() }
  }

  // ── Split body into chunks ────────────────────────────────────────────────
  const bodyChildren = $('body').children().toArray()
  const rawChunks: string[] = []
  let buffer = ''

  for (const el of bodyChildren) {
    const elHtml = $.html(el) ?? ''
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? ''
    if (['section', 'article', 'aside', 'main', 'div'].includes(tag) && elHtml.length > 200) {
      if (buffer.trim()) { rawChunks.push(buffer); buffer = '' }
      rawChunks.push(elHtml)
    } else {
      buffer += elHtml
    }
  }
  if (buffer.trim()) rawChunks.push(buffer)
  if (rawChunks.length === 0) rawChunks.push($('body').html() ?? html)

  // ── Merge consecutive card-like chunks into product grids ─────────────────
  // Gemini sometimes generates each product card as a separate top-level div.
  // If 3+ consecutive "small" chunks each have 1-2 images, merge them.
  const chunks: string[] = []
  let cardBuffer: string[] = []

  const flushCards = () => {
    if (cardBuffer.length >= 3) {
      chunks.push(cardBuffer.join('\n'))
    } else {
      chunks.push(...cardBuffer)
    }
    cardBuffer = []
  }

  for (const chunk of rawChunks) {
    const imgs = countImages(chunk)
    const isCardLike = imgs >= 1 && imgs <= 3 && chunk.length < 4000
    if (isCardLike) {
      cardBuffer.push(chunk)
    } else {
      flushCards()
      chunks.push(chunk)
    }
  }
  flushCards()

  // ── Build body sections ───────────────────────────────────────────────────
  const usedNames: Record<string, number> = {}
  const sections: Record<string, string> = {}
  const order: string[] = []
  let announcementBarHtml = ''

  for (let i = 0; i < chunks.length; i++) {
    const chunkHtml = chunks[i]
    const type = classifySection(chunkHtml, i === 0)

    if (type === 'announcement-bar') {
      announcementBarHtml = chunkHtml
      continue
    }

    usedNames[type] = (usedNames[type] ?? 0) + 1
    const name = usedNames[type] === 1 ? type : `${type}-${usedNames[type]}`
    const imgCount = countImages(chunkHtml)

    let sectionContent = ''

    if (type === 'hero') {
      const { liquid, defaults } = liquidifyHero(chunkHtml)
      sectionContent = liquid + schemaTag(buildHeroSchema(defaults))
    } else if (type === 'product-grid') {
      const $c = load(chunkHtml)
      const heading = $c('h2, h3').first().text().trim()
      sectionContent = productGridLiquid(heading) + schemaTag(buildProductGridSchema({ heading }))
    } else {
      const { liquid, defaults } = liquidifyContent(chunkHtml)
      const displayName = type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, ' ')
      sectionContent = liquid + schemaTag(buildContentSchema(displayName, defaults, imgCount >= 2))
    }

    sections[name] = sectionContent
    order.push(name)
  }

  // ── Build header static section ───────────────────────────────────────────
  const { liquid: headerLiquid } = buildHeaderSection(announcementBarHtml, navHtml)
  sections['igualai-header'] = headerLiquid

  // ── Build footer static section ───────────────────────────────────────────
  if (footerHtml) {
    sections['igualai-footer'] = buildFooterSection(footerHtml)
  }

  return {
    sections,
    order,
    headerSectionName: 'igualai-header',
    footerSectionName: footerHtml ? 'igualai-footer' : '',
  }
}
