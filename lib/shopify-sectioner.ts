/**
 * shopify-sectioner — converts a static HTML clone into Shopify liquid sections
 *
 * Splits the page using cheerio, injects Liquid variables into key elements
 * so settings are actually wired up, and generates proper {% schema %} blocks.
 */

import { load, type CheerioAPI } from 'cheerio'

export interface ShopifySections {
  sections: Record<string, string>
  order: string[]
  /** Full header block for layout/theme.liquid (announcement bar + nav) */
  headerHtml: string
  /** Footer block for layout/theme.liquid */
  footerHtml: string
}

// ── Schema templates ───────────────────────────────────────────────────────

function announcementSchema(defaults: Record<string, string>) {
  return {
    name: 'Announcement Bar',
    settings: [
      { type: 'text', id: 'text', label: 'Announcement text', default: defaults.text ?? '' },
      { type: 'color', id: 'bg_color', label: 'Background color', default: defaults.bg_color ?? '#1a5c3a' },
      { type: 'color', id: 'text_color', label: 'Text color', default: '#ffffff' },
    ],
    presets: [{ name: 'Announcement Bar' }],
  }
}

function heroSchema(defaults: Record<string, string>) {
  return {
    name: 'Hero',
    settings: [
      { type: 'text', id: 'heading', label: 'Heading', default: defaults.heading ?? '' },
      { type: 'textarea', id: 'subheading', label: 'Subheading', default: defaults.subheading ?? '' },
      { type: 'text', id: 'button_label', label: 'Primary button', default: defaults.button_label ?? '' },
      { type: 'url', id: 'button_url', label: 'Primary button URL' },
      { type: 'text', id: 'button2_label', label: 'Secondary button', default: defaults.button2_label ?? '' },
      { type: 'url', id: 'button2_url', label: 'Secondary button URL' },
      { type: 'image_picker', id: 'bg_image', label: 'Background image' },
    ],
    presets: [{ name: 'Hero' }],
  }
}

function productGridSchema(defaults: Record<string, string>) {
  return {
    name: 'Product Grid',
    settings: [
      { type: 'text', id: 'heading', label: 'Section heading', default: defaults.heading ?? 'Our Products' },
      { type: 'collection', id: 'collection', label: 'Collection' },
      { type: 'range', id: 'products_to_show', label: 'Products to show', min: 2, max: 12, step: 1, default: 6 },
      { type: 'range', id: 'columns', label: 'Columns', min: 2, max: 4, step: 1, default: 3 },
    ],
    presets: [{ name: 'Product Grid' }],
  }
}

function contentSchema(name: string, defaults: Record<string, string>) {
  return {
    name,
    settings: [
      { type: 'text', id: 'heading', label: 'Heading', default: defaults.heading ?? '' },
      { type: 'textarea', id: 'subheading', label: 'Subheading', default: defaults.subheading ?? '' },
      { type: 'color', id: 'bg_color', label: 'Background color', default: '#ffffff' },
    ],
    presets: [{ name }],
  }
}

function schemaTag(obj: object): string {
  return `\n{% schema %}\n${JSON.stringify(obj, null, 2)}\n{% endschema %}`
}

// ── Liquid injection ───────────────────────────────────────────────────────

function getBodyHtml($: CheerioAPI): string {
  return $('body').html() ?? ''
}

/** Replace heading/subheading/buttons with Liquid vars, return modified HTML + defaults */
function liquidifyHero(chunkHtml: string): { liquid: string; defaults: Record<string, string> } {
  const $ = load(chunkHtml)
  const defaults: Record<string, string> = {}

  const h1 = $('h1').first()
  if (h1.length) {
    defaults.heading = h1.text().trim().slice(0, 255)
    h1.html('{{ section.settings.heading }}')
  } else {
    const h2 = $('h2').first()
    if (h2.length) {
      defaults.heading = h2.text().trim().slice(0, 255)
      h2.html('{{ section.settings.heading }}')
    }
  }

  const firstP = $('p').first()
  if (firstP.length) {
    defaults.subheading = firstP.text().trim().slice(0, 500)
    firstP.html('{{ section.settings.subheading }}')
  }

  // Buttons/CTAs
  const btns = $('a[class*="btn"], a[class*="button"], button, .cta, [class*="cta"]').toArray()
  if (btns[0]) {
    const b = $(btns[0])
    defaults.button_label = b.text().trim().slice(0, 80)
    b.html('{{ section.settings.button_label }}')
    if (b.attr('href')) b.attr('href', '{{ section.settings.button_url }}')
  }
  if (btns[1]) {
    const b = $(btns[1])
    defaults.button2_label = b.text().trim().slice(0, 80)
    b.html('{{ section.settings.button2_label }}')
    if (b.attr('href')) b.attr('href', '{{ section.settings.button2_url }}')
  }

  return { liquid: getBodyHtml($), defaults }
}

/** Replace announcement bar text with Liquid var */
function liquidifyAnnouncement(chunkHtml: string): { liquid: string; defaults: Record<string, string> } {
  const $ = load(chunkHtml)
  const defaults: Record<string, string> = {}

  // Get the text content of the bar
  const text = $('body').text().trim()
  if (text) defaults.text = text.slice(0, 255)

  // Wrap with Liquid-controlled styles + text
  const inner = `<div style="background-color:{{ section.settings.bg_color }};color:{{ section.settings.text_color }};text-align:center;padding:0.5rem 1rem;font-size:0.875rem">{{ section.settings.text }}</div>`

  return { liquid: inner, defaults }
}

/** Replace section heading/subheading with Liquid vars */
function liquidifyContent(chunkHtml: string, sectionName: string): { liquid: string; defaults: Record<string, string> } {
  const $ = load(chunkHtml)
  const defaults: Record<string, string> = {}

  const heading = $('h1, h2, h3').first()
  if (heading.length) {
    defaults.heading = heading.text().trim().slice(0, 255)
    heading.html('{{ section.settings.heading }}')
  }

  const sub = $('p').first()
  if (sub.length) {
    defaults.subheading = sub.text().trim().slice(0, 500)
    sub.html('{{ section.settings.subheading }}')
  }

  return { liquid: getBodyHtml($), defaults }
}

// ── Product loop ──────────────────────────────────────────────────────────

function productGridLiquid(headingDefault: string): string {
  return `<div class="igualai-product-grid-section">
  {% if section.settings.heading != blank %}
    <h2 style="text-align:center;padding:2rem 1rem 0.5rem;font-size:1.75rem">{{ section.settings.heading }}</h2>
  {% endif %}
  <div style="display:grid;grid-template-columns:repeat({{ section.settings.columns }},1fr);gap:1.5rem;padding:2rem;max-width:1200px;margin:0 auto">
    {% assign coll = collections[section.settings.collection] %}
    {% if coll != blank %}
      {% for product in coll.products limit: section.settings.products_to_show %}
        <a href="{{ product.url }}" style="display:block;text-decoration:none;color:inherit">
          <img src="{{ product.featured_image | img_url: '500x500' }}" alt="{{ product.title }}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px">
          <p style="font-weight:600;margin:.75rem 0 .25rem">{{ product.title }}</p>
          <p style="opacity:.7">{{ product.price | money }}</p>
        </a>
      {% endfor %}
    {% else %}
      <p style="grid-column:1/-1;text-align:center;padding:3rem 1rem;opacity:.5">
        👆 Select a collection above to display your products here.
      </p>
    {% endif %}
  </div>
</div>`
}

// ── Classifiers ────────────────────────────────────────────────────────────

function classifySection(html: string, isFirst: boolean): string {
  const lower = html.toLowerCase()
  const imgCount = (html.match(/<img/gi) ?? []).length
  const textLen = html.replace(/<[^>]+>/g, '').trim().length

  // Announcement bar: short text, often first, common phrases
  if (
    textLen < 200 &&
    (lower.includes('free shipping') || lower.includes('% off') || lower.includes('sale') ||
     lower.includes('new arrivals') || lower.includes('limited time') || isFirst && textLen < 100)
  ) {
    return 'announcement-bar'
  }

  // Product grid: 4+ images OR 3+ images in a grid-like container OR product/price keywords
  const isGrid = lower.includes('grid') || lower.includes('product') || lower.includes('shop') ||
                 lower.includes('collection') || lower.includes('price') || lower.includes('$') ||
                 lower.includes('mosaic') || lower.includes('card')
  if (imgCount >= 4 || (imgCount >= 3 && isGrid)) {
    return 'product-grid'
  }

  // Hero: large heading + CTA buttons near top
  if (
    (lower.includes('<h1') || lower.includes('hero') || lower.includes('banner')) &&
    (lower.includes('btn') || lower.includes('button') || lower.includes('<a ') || lower.includes('cta'))
  ) {
    return 'hero'
  }

  // Testimonials
  if (lower.includes('review') || lower.includes('testimonial') || lower.includes('★') || lower.includes('rating')) {
    return 'testimonials'
  }

  // Lifestyle / brand story
  if (imgCount >= 1 && (lower.includes('story') || lower.includes('about') || lower.includes('mission') || lower.includes('values') || lower.includes('lifestyle'))) {
    return 'lifestyle'
  }

  // Features
  if (lower.includes('feature') || (lower.includes('<h2') && lower.includes('<h3'))) {
    return 'features'
  }

  return 'content'
}

// ── Main export ────────────────────────────────────────────────────────────

export async function htmlToShopifySections(html: string): Promise<ShopifySections> {
  const $ = load(html, { xmlMode: false } as never)

  // ── Extract footer ───────────────────────────────────────────────────────
  let footerHtml = ''
  const footerEl = $('footer').first()
  if (footerEl.length) {
    footerHtml = $.html(footerEl) ?? ''
    footerEl.remove()
  }

  // ── Extract header/nav ───────────────────────────────────────────────────
  let navHtml = ''
  const headerEl = $('header').first()
  if (headerEl.length) {
    navHtml = $.html(headerEl) ?? ''
    headerEl.remove()
  } else {
    const navEl = $('nav').first()
    if (navEl.length) {
      navHtml = $.html(navEl) ?? ''
      navEl.remove()
    }
  }

  // ── Split body into top-level chunks ────────────────────────────────────
  const bodyChildren = $('body').children().toArray()
  const chunks: string[] = []
  let buffer = ''

  for (const el of bodyChildren) {
    const elHtml = $.html(el) ?? ''
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? ''
    if (['section', 'article', 'aside', 'main', 'div'].includes(tag) && elHtml.length > 200) {
      if (buffer.trim()) { chunks.push(buffer); buffer = '' }
      chunks.push(elHtml)
    } else {
      buffer += elHtml
    }
  }
  if (buffer.trim()) chunks.push(buffer)
  if (chunks.length === 0) chunks.push($('body').html() ?? html)

  // ── Build section files ──────────────────────────────────────────────────
  const usedNames: Record<string, number> = {}
  const sections: Record<string, string> = {}
  const order: string[] = []
  let announcementBarHtml = '' // will be prepended to nav in layout

  for (let i = 0; i < chunks.length; i++) {
    const chunkHtml = chunks[i]
    const type = classifySection(chunkHtml, i === 0)

    usedNames[type] = (usedNames[type] ?? 0) + 1
    const name = usedNames[type] === 1 ? type : `${type}-${usedNames[type]}`

    let sectionContent = ''

    if (type === 'announcement-bar') {
      const { liquid, defaults } = liquidifyAnnouncement(chunkHtml)
      // Move announcement bar into layout (before nav) instead of as a section
      announcementBarHtml = liquid
      continue // skip adding as section
    } else if (type === 'hero') {
      const { liquid, defaults } = liquidifyHero(chunkHtml)
      sectionContent = liquid + schemaTag(heroSchema(defaults))
    } else if (type === 'product-grid') {
      const $c = load(chunkHtml)
      const heading = $c('h2, h3').first().text().trim()
      sectionContent = productGridLiquid(heading) + schemaTag(productGridSchema({ heading }))
    } else {
      const { liquid, defaults } = liquidifyContent(chunkHtml, name)
      const displayName = type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, ' ')
      sectionContent = liquid + schemaTag(contentSchema(displayName, defaults))
    }

    sections[name] = sectionContent
    order.push(name)
  }

  // Build headerHtml: announcement bar (if found) + nav
  const headerHtml = [announcementBarHtml, navHtml].filter(Boolean).join('\n')

  return { sections, order, headerHtml, footerHtml }
}
