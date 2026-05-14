/**
 * shopify-sectioner — converts a static HTML clone into Shopify liquid sections
 *
 * Uses cheerio to split the page into logical sections and attaches
 * Shopify {% schema %} blocks so each section is editable in the theme editor.
 * The product grid section gets a real Liquid collection loop with a collection picker.
 */

import { load } from 'cheerio'

export interface ShopifySections {
  sections: Record<string, string>
  order: string[]
  /** header HTML extracted for layout/theme.liquid (nav + announcement bar) */
  headerHtml: string
  /** footer HTML extracted for layout/theme.liquid */
  footerHtml: string
}

// ── Schema templates ───────────────────────────────────────────────────────

const SCHEMAS: Record<string, object> = {
  'announcement-bar': {
    name: 'Announcement Bar',
    settings: [
      { type: 'text', id: 'text', label: 'Announcement text', default: 'Free shipping on orders over $75' },
      { type: 'color', id: 'bg_color', label: 'Background color', default: '#1a5c3a' },
      { type: 'color', id: 'text_color', label: 'Text color', default: '#ffffff' },
    ],
    presets: [{ name: 'Announcement Bar' }],
  },
  hero: {
    name: 'Hero',
    settings: [
      { type: 'text', id: 'heading', label: 'Heading' },
      { type: 'textarea', id: 'subheading', label: 'Subheading' },
      { type: 'text', id: 'button_label', label: 'Primary button label' },
      { type: 'url', id: 'button_url', label: 'Primary button URL' },
      { type: 'text', id: 'secondary_button_label', label: 'Secondary button label' },
      { type: 'url', id: 'secondary_button_url', label: 'Secondary button URL' },
      { type: 'image_picker', id: 'background_image', label: 'Background image' },
      { type: 'color', id: 'overlay_color', label: 'Overlay color', default: '#000000' },
      { type: 'range', id: 'overlay_opacity', label: 'Overlay opacity', min: 0, max: 100, step: 5, default: 40, unit: '%' },
    ],
    presets: [{ name: 'Hero' }],
  },
  'product-grid': {
    name: 'Product Grid',
    settings: [
      { type: 'text', id: 'heading', label: 'Section heading', default: 'Our Products' },
      { type: 'collection', id: 'collection', label: 'Collection' },
      { type: 'range', id: 'products_to_show', label: 'Products to show', min: 2, max: 12, step: 1, default: 6 },
      { type: 'range', id: 'columns', label: 'Columns', min: 2, max: 4, step: 1, default: 3 },
      { type: 'color', id: 'bg_color', label: 'Background color', default: '#ffffff' },
    ],
    presets: [{ name: 'Product Grid' }],
  },
  features: {
    name: 'Features',
    settings: [
      { type: 'text', id: 'heading', label: 'Section heading' },
      { type: 'textarea', id: 'subheading', label: 'Subheading' },
      { type: 'color', id: 'bg_color', label: 'Background color', default: '#f9f9f9' },
    ],
    presets: [{ name: 'Features' }],
  },
  lifestyle: {
    name: 'Lifestyle Section',
    settings: [
      { type: 'text', id: 'heading', label: 'Heading' },
      { type: 'textarea', id: 'subheading', label: 'Subheading' },
      { type: 'image_picker', id: 'image', label: 'Image' },
      { type: 'color', id: 'bg_color', label: 'Background color', default: '#000000' },
      { type: 'color', id: 'text_color', label: 'Text color', default: '#ffffff' },
    ],
    presets: [{ name: 'Lifestyle Section' }],
  },
  testimonials: {
    name: 'Testimonials',
    settings: [
      { type: 'text', id: 'heading', label: 'Heading', default: 'What Our Customers Say' },
      { type: 'color', id: 'bg_color', label: 'Background color', default: '#f9f9f9' },
    ],
    presets: [{ name: 'Testimonials' }],
  },
  content: {
    name: 'Content',
    settings: [
      { type: 'color', id: 'bg_color', label: 'Background color', default: '#ffffff' },
    ],
    presets: [{ name: 'Content' }],
  },
}

/** Liquid product loop used in product-grid sections */
const PRODUCT_LOOP = `
<div class="igualai-product-grid" style="display:grid;grid-template-columns:repeat({{ section.settings.columns }},1fr);gap:1.5rem;padding:2rem">
  {% assign coll = collections[section.settings.collection] %}
  {% if coll != blank %}
    {% for product in coll.products limit: section.settings.products_to_show %}
      <a href="{{ product.url }}" style="display:block;text-decoration:none;color:inherit">
        <img src="{{ product.featured_image | img_url: '400x400' }}" alt="{{ product.title }}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px">
        <p style="font-weight:600;margin:.75rem 0 .25rem">{{ product.title }}</p>
        <p style="opacity:.7">{{ product.price | money }}</p>
      </a>
    {% endfor %}
  {% else %}
    <p style="grid-column:1/-1;text-align:center;padding:3rem;opacity:.5">
      Select a collection in the theme editor to display products.
    </p>
  {% endif %}
</div>`

// ── Classifiers ────────────────────────────────────────────────────────────

function classifySection(html: string): string {
  const lower = html.toLowerCase()
  // Product grid: many images in a grid/list pattern
  const imgCount = (html.match(/<img/gi) ?? []).length
  if (imgCount >= 3 && (lower.includes('product') || lower.includes('shop') || lower.includes('collection') || lower.includes('price') || lower.includes('$'))) {
    return 'product-grid'
  }
  // Announcement bar: short, often at top
  if (html.length < 500 && (lower.includes('free shipping') || lower.includes('sale') || lower.includes('off') || lower.includes('announcement'))) {
    return 'announcement-bar'
  }
  // Hero: large heading + buttons or background image
  if ((lower.includes('<h1') || lower.includes('hero')) && (lower.includes('button') || lower.includes('btn') || lower.includes('<a '))) {
    return 'hero'
  }
  // Testimonials
  if (lower.includes('review') || lower.includes('testimonial') || lower.includes('stars') || lower.includes('★') || lower.includes('rating')) {
    return 'testimonials'
  }
  // Lifestyle / brand sections with large images
  if (imgCount >= 1 && (lower.includes('lifestyle') || lower.includes('story') || lower.includes('about') || lower.includes('mission') || lower.includes('values'))) {
    return 'lifestyle'
  }
  // Feature cards
  if (lower.includes('feature') || (lower.includes('<h2') && lower.includes('<h3'))) {
    return 'features'
  }
  return 'content'
}

function schemaBlock(type: string, index: number): string {
  const schema = SCHEMAS[type] ?? SCHEMAS.content
  const named = { ...schema as Record<string, unknown>, name: (schema as Record<string, unknown>).name ?? type }
  return `\n{% schema %}\n${JSON.stringify(named, null, 2)}\n{% endschema %}`
}

// ── Main export ────────────────────────────────────────────────────────────

export async function htmlToShopifySections(html: string): Promise<ShopifySections> {
  const $ = load(html, { xmlMode: false } as never)

  // ── Extract header (announcement bar + nav) ──────────────────────────────
  let headerHtml = ''
  const headerEl = $('header').first()
  if (headerEl.length) {
    headerHtml = $.html(headerEl) ?? ''
    headerEl.remove()
  } else {
    // Fallback: grab nav element
    const navEl = $('nav').first()
    if (navEl.length) {
      headerHtml = $.html(navEl) ?? ''
      navEl.remove()
    }
  }

  // ── Extract footer ───────────────────────────────────────────────────────
  let footerHtml = ''
  const footerEl = $('footer').first()
  if (footerEl.length) {
    footerHtml = $.html(footerEl) ?? ''
    footerEl.remove()
  }

  // ── Split body into top-level sections ──────────────────────────────────
  const bodyChildren = $('body').children().toArray()

  // Merge small consecutive non-section elements into groups
  const chunks: string[] = []
  let buffer = ''

  for (const el of bodyChildren) {
    const elHtml = $.html(el) ?? ''
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? ''

    // Section-like elements always get their own chunk
    if (['section', 'article', 'aside', 'main', 'div'].includes(tag) && elHtml.length > 300) {
      if (buffer.trim()) { chunks.push(buffer); buffer = '' }
      chunks.push(elHtml)
    } else {
      buffer += elHtml
    }
  }
  if (buffer.trim()) chunks.push(buffer)

  // Fallback: if no chunks found, use the entire body
  if (chunks.length === 0) {
    const bodyHtml = $('body').html() ?? html
    chunks.push(bodyHtml)
  }

  // ── Build section files ──────────────────────────────────────────────────
  const usedNames: Record<string, number> = {}
  const sections: Record<string, string> = {}
  const order: string[] = []

  for (let i = 0; i < chunks.length; i++) {
    const chunkHtml = chunks[i]
    let type = classifySection(chunkHtml)

    // Deduplicate names (two "content" sections → content, content-2)
    usedNames[type] = (usedNames[type] ?? 0) + 1
    const name = usedNames[type] === 1 ? type : `${type}-${usedNames[type]}`

    let sectionContent: string
    if (type === 'product-grid') {
      // Replace static product HTML with Liquid loop, keep surrounding wrapper
      const $chunk = load(chunkHtml)
      const heading = $chunk('h2, h3').first().text().trim()
      sectionContent = `<div class="igualai-section-product-grid">
  {% if section.settings.heading != blank %}<h2 style="text-align:center;padding:2rem 1rem 0">{{ section.settings.heading }}</h2>{% endif %}
  ${PRODUCT_LOOP}
</div>`
      // Pre-fill heading default if we found one
      if (heading) {
        const schema = JSON.parse(JSON.stringify(SCHEMAS['product-grid']))
        const headingSetting = (schema.settings as Array<{id: string; default?: string}>).find((s) => s.id === 'heading')
        if (headingSetting) headingSetting.default = heading.slice(0, 80)
        sectionContent += `\n{% schema %}\n${JSON.stringify(schema, null, 2)}\n{% endschema %}`
      } else {
        sectionContent += schemaBlock(type, i)
      }
    } else {
      sectionContent = chunkHtml + schemaBlock(type, i)
    }

    sections[name] = sectionContent
    order.push(name)
  }

  return { sections, order, headerHtml, footerHtml }
}
