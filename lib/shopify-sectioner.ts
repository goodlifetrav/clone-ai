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

/** Detect the dominant background color of a section using Cheerio DOM traversal.
 *  Walks elements top-down in document order, skipping form controls (input, button, etc.)
 *  and low-alpha rgba backgrounds, so it finds the true section background regardless of
 *  how deeply nested it is. */
function detectBgColor(html: string): string {
  const $ = load(html)
  const SKIP_TAGS = new Set(['input', 'button', 'select', 'textarea', 'label', 'option', 'script', 'style', 'svg', 'path'])

  let found = ''
  $('body *').each((_, el) => {
    if (found) return false
    const tag = ((el as { tagName?: string }).tagName ?? '').toLowerCase()
    if (SKIP_TAGS.has(tag)) return

    const style = ($(el).attr('style') ?? '')
    const cls = ($(el).attr('class') ?? '')

    // Inline style — hex
    const hexMatch = style.match(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,8})/i)
    if (hexMatch) { found = hexMatch[1]; return false }

    // Inline style — rgb/rgba (skip if alpha < 0.5 — translucent overlays are not the bg)
    const rgbMatch = style.match(/background(?:-color)?\s*:\s*rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i)
    if (rgbMatch) {
      const alpha = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1
      if (alpha >= 0.5) {
        const [r, g, b] = [rgbMatch[1], rgbMatch[2], rgbMatch[3]].map(v => parseInt(v))
        found = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
        return false
      }
      return // low-alpha tint — skip and keep looking
    }

    if (/background(?:-color)?\s*:\s*black\b/i.test(style)) { found = '#000000'; return false }
    if (/background(?:-color)?\s*:\s*white\b/i.test(style)) { found = '#ffffff'; return false }

    // Tailwind classes
    const arbitrary = cls.match(/\bbg-\[#([0-9a-f]{3,8})\]/i)
    if (arbitrary) { found = `#${arbitrary[1]}`; return false }

    if (/\b(?:bg-black|bg-gray-9\d{2}|bg-neutral-9\d{2}|bg-zinc-9\d{2}|bg-slate-9\d{2})\b/.test(cls)) { found = '#000000'; return false }
    if (/\b(?:bg-gray-8\d{2}|bg-neutral-8\d{2})\b/.test(cls)) { found = '#1f2937'; return false }
    if (/\b(?:bg-gray-7\d{2}|bg-neutral-7\d{2})\b/.test(cls)) { found = '#374151'; return false }
  })

  return found || '#ffffff'
}

/** Inject bg_color and text_color Liquid vars using a scoped {% style %} block with !important.
 *  Also injects Tailwind utility shims for layout-critical classes that Shopify CSP blocks
 *  (Tailwind CDN is not allowed in Shopify storefronts). */
function injectColorVars(html: string): string {
  const $ = load(html)
  const outer = $('body').children().first()

  // Tailwind shims — only inject classes actually present in this section's HTML.
  // Scoped to [data-igualai-id] so they don't leak to other theme sections.
  const shimLines: string[] = []
  const has = (s: string) => html.includes(s)

  if (has('overflow-hidden'))  shimLines.push(`  [data-igualai-id="{{ section.id }}"] .overflow-hidden { overflow: hidden !important; }`)
  if (has('whitespace-nowrap')) shimLines.push(`  [data-igualai-id="{{ section.id }}"] .whitespace-nowrap { white-space: nowrap !important; }`)
  if (has('"flex') || has(' flex ') || has("'flex") || has('class="flex"') || has('flex items'))
    shimLines.push(`  [data-igualai-id="{{ section.id }}"] .flex { display: flex !important; }`)
  if (has('inline-flex'))      shimLines.push(`  [data-igualai-id="{{ section.id }}"] .inline-flex { display: inline-flex !important; }`)
  if (has('items-center'))     shimLines.push(`  [data-igualai-id="{{ section.id }}"] .items-center { align-items: center !important; }`)
  if (has('justify-center'))   shimLines.push(`  [data-igualai-id="{{ section.id }}"] .justify-center { justify-content: center !important; }`)
  if (has('justify-between'))  shimLines.push(`  [data-igualai-id="{{ section.id }}"] .justify-between { justify-content: space-between !important; }`)

  // Marquee animation — Shopify CSP blocks Tailwind CDN so animate-marquee never fires.
  // Inject the keyframe + animation rule directly so the ticker works out of the box.
  if (has('animate-marquee') || has('animate-scroll') || has('animate-ticker')) {
    shimLines.push(
      `  @keyframes igualai-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }`,
      `  [data-igualai-id="{{ section.id }}"] .animate-marquee,`,
      `  [data-igualai-id="{{ section.id }}"] .animate-scroll,`,
      `  [data-igualai-id="{{ section.id }}"] .animate-ticker { animation: igualai-marquee 20s linear infinite !important; white-space: nowrap !important; }`,
    )
  }

  const tailwindShims = shimLines.length ? '\n' + shimLines.join('\n') : ''

  const styleBlock = `{%- style -%}
  [data-igualai-id="{{ section.id }}"] { background-color: {{ section.settings.bg_color }} !important; color: {{ section.settings.text_color }}; }
  [data-igualai-id="{{ section.id }}"] p,
  [data-igualai-id="{{ section.id }}"] h1,
  [data-igualai-id="{{ section.id }}"] h2,
  [data-igualai-id="{{ section.id }}"] h3,
  [data-igualai-id="{{ section.id }}"] h4,
  [data-igualai-id="{{ section.id }}"] h5,
  [data-igualai-id="{{ section.id }}"] h6,
  [data-igualai-id="{{ section.id }}"] li { color: {{ section.settings.text_color }} !important; }
  [data-igualai-id="{{ section.id }}"] a[class*="bg-"]:not([class*="bg-transparent"]):not([class*="bg-white"]):not([class*="bg-opacity-0"]),
  [data-igualai-id="{{ section.id }}"] button[class*="bg-"]:not([class*="bg-transparent"]):not([class*="bg-white"]):not([class*="bg-opacity-0"]) { background-color: var(--color-button) !important; color: var(--color-button-text) !important; }${tailwindShims}
{%- endstyle -%}`

  if (outer.length) {
    outer.attr('data-igualai-id', '{{ section.id }}')
    // Strip any hardcoded background-color from inline style so our scoped rule wins
    const existingStyle = (outer.attr('style') ?? '')
      .replace(/background(?:-color)?\s*:[^;]+;?\s*/gi, '')
      .replace(/^\s*;?\s*|\s*;?\s*$/g, '')
    if (existingStyle) outer.attr('style', existingStyle)
    else outer.removeAttr('style')
    return styleBlock + '\n' + bodyHtml($)
  }
  return `${styleBlock}\n<div data-igualai-id="{{ section.id }}">${html}</div>`
}

/** Count visual "images" — img tags, CSS backgrounds, gradients, and IgualAI product card placeholders */
function countImages(html: string): number {
  const imgTags = (html.match(/<img[\s>]/gi) ?? []).length
  const bgImages = (html.match(/url\(["']?https?:/gi) ?? []).length
  const gradients = (html.match(/linear-gradient|radial-gradient/gi) ?? []).length
  // Tailwind fixed-height containers (h-48..h-96, aspect-*) — product image placeholders
  const tailwindPlaceholders = (html.match(/class="[^"]*\b(?:h-(?:48|56|64|72|80|96)|aspect-(?:square|video|ratio))\b/gi) ?? []).length
  // Full-width gradient blocks — IgualAI card image placeholder pattern: "w-full ... bg-gradient-to-*"
  // These are the tall card image areas in rebuilt lifestyle/product sections (distinct from small w-10/w-12 icon backgrounds)
  const fullWidthGradients = (html.match(/class="[^"]*w-full[^"]*bg-gradient-to-/gi) ?? []).length
  return imgTags + bgImages + gradients + tailwindPlaceholders + fullWidthGradients
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

function classifySection(html: string, isFirst: boolean, pageType?: string): string {
  // Check for explicit data-igualai-section attribute set by Gemini during brand rebuild
  const dataAttr = html.match(/data-igualai-section="([^"]+)"/i)?.[1]
  if (dataAttr) {
    const valid = ['announcement-bar', 'hero', 'product-grid', 'product-main', 'collection-list', 'testimonials', 'features', 'lifestyle', 'newsletter', 'content']
    if (valid.includes(dataAttr)) return dataAttr
  }

  const lower = html.toLowerCase()
  const textLen = html.replace(/<[^>]+>/g, '').trim().length
  const imgCount = countImages(html)

  // Product main section: has price + add-to-cart indicators
  if (
    (lower.includes('add to cart') || lower.includes('add-to-cart') || lower.includes('addtocart')) &&
    (lower.match(/\$[\d,]+\.\d{2}/) || lower.includes('product__price') || lower.includes('product-price') || lower.includes('price'))
  ) return 'product-main'

  // Announcement bar: very short text content
  if (textLen < 200 && (
    lower.includes('free shipping') || lower.includes('% off') || lower.includes('new arrivals') ||
    lower.includes('limited time') || lower.includes('today only') ||
    (isFirst && textLen < 120 && !lower.includes('<nav'))
  )) return 'announcement-bar'

  // Collection list: multiple cards each linking to a /collections/ page
  // This is distinct from product-grid (which shows products *within* one collection)
  const collectionLinks = (html.match(/href=["'][^"']*\/collections\/[^"']+["']/gi) ?? []).length
  if (collectionLinks >= 2 && imgCount >= 2) return 'collection-list'

  // NOTE: imgCount >= 3 no longer auto-classifies as product-grid.
  // A dynamic Shopify collection grid is only generated when Gemini explicitly marks
  // a section with data-igualai-section="product-grid". All other multi-image sections
  // (feature cards, product showcases, lifestyle grids) render as static HTML so the
  // designed layout from IgualAI is preserved across all page types.

  // Hero: has a large heading + CTA button
  if (
    (lower.includes('<h1') || lower.includes('hero') || lower.includes('banner')) &&
    (lower.includes('btn') || lower.includes('button') || (lower.includes('<a ') && lower.includes('href')))
  ) return 'hero'

  // Newsletter: has an email input field
  if (lower.includes('type="email"') || lower.includes("type='email'") ||
      /placeholder=["'][^"']*email/i.test(html) ||
      (lower.includes('subscribe') && lower.includes('<input')) ||
      (lower.includes('newsletter') && lower.includes('<input'))) return 'newsletter'

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

function buildHeroSchema(d: Record<string, string>, bg = '#000000') {
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
      { type: 'color', id: 'bg_color', label: 'Background color', default: bg },
      { type: 'color', id: 'text_color', label: 'Text color', default: '#ffffff' },
    ],
    presets: [{ name: 'Hero' }],
  }
}

function buildProductGridSchema(d: Record<string, string>, bg = '#ffffff') {
  return {
    name: 'Product Grid',
    settings: [
      setting({ type: 'text', id: 'heading', label: 'Section heading' }, d.heading),
      { type: 'collection', id: 'collection', label: 'Collection (shows real products)' },
      { type: 'range', id: 'products_to_show', label: 'Products to show', min: 2, max: 12, step: 1, default: 6 },
      { type: 'range', id: 'columns', label: 'Columns', min: 2, max: 4, step: 1, default: 3 },
      { type: 'checkbox', id: 'show_price', label: 'Show price', default: true },
      { type: 'color', id: 'bg_color', label: 'Background color', default: bg },
      { type: 'color', id: 'text_color', label: 'Text color', default: '#111111' },
    ],
    presets: [{ name: 'Product Grid' }],
  }
}

function buildContentSchema(name: string, d: Record<string, string>, hasImages: boolean, bg = '#ffffff') {
  return {
    name,
    settings: [
      setting({ type: 'text', id: 'heading', label: 'Heading' }, d.heading),
      setting({ type: 'textarea', id: 'subheading', label: 'Subheading' }, d.subheading),
      ...(hasImages ? [{ type: 'collection', id: 'collection', label: 'Link a collection (optional)' }] : []),
      { type: 'color', id: 'bg_color', label: 'Background color', default: bg },
      { type: 'color', id: 'text_color', label: 'Text color', default: bg === '#ffffff' ? '#111111' : '#ffffff' },
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

function buildFooterSchema(d: { newsletterHeading?: string; subscribeBtn?: string } = {}) {
  return {
    name: 'Footer',
    class: 'section-footer',
    settings: [
      ...(d.newsletterHeading !== undefined ? [
        setting({ type: 'text', id: 'newsletter_heading', label: 'Newsletter heading' }, d.newsletterHeading),
        setting({ type: 'text', id: 'subscribe_btn', label: 'Subscribe button text' }, d.subscribeBtn),
      ] : []),
      { type: 'link_list', id: 'menu1', label: 'Footer links column 1', default: 'footer' },
      { type: 'link_list', id: 'menu2', label: 'Footer links column 2' },
      { type: 'link_list', id: 'menu3', label: 'Footer links column 3' },
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

function productGridLiquid(heading: string, isCollectionPage = false): string {
  // Collection pages: `collection` is already Shopify's current collection — no sidebar config needed.
  // Other pages: user selects a collection in the Theme Editor sidebar.
  const collAssign = isCollectionPage ? '' : `{% assign coll = collections[section.settings.collection] %}`
  const collVar = isCollectionPage ? 'collection' : 'coll'

  return `<div class="igualai-product-section">
  {% if section.settings.heading != blank %}
    <h2 style="text-align:center;padding:2rem 1rem 0.5rem;font-size:1.75rem;font-weight:700">
      {{ section.settings.heading }}
    </h2>
  {% endif %}
  <div style="display:grid;grid-template-columns:repeat({{ section.settings.columns }},1fr);gap:1.5rem;padding:1.5rem 2rem;max-width:1280px;margin:0 auto">
    ${collAssign}
    {% if ${collVar} != blank %}
      {% for product in ${collVar}.products limit: section.settings.products_to_show %}
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

// ── Collection list Liquid ───────────────────────────────────────────────────

function collectionListLiquid(heading: string): string {
  return `<div class="igualai-collection-list">
  {% if section.settings.heading != blank %}
    <h2 style="text-align:center;padding:2rem 1rem 0.5rem;font-size:1.75rem;font-weight:700">
      {{ section.settings.heading }}
    </h2>
  {% endif %}
  <div style="display:grid;grid-template-columns:repeat({{ section.settings.columns }},1fr);gap:1.5rem;padding:1.5rem 2rem;max-width:1280px;margin:0 auto">
    {% for i in (1..4) %}
      {%- assign coll_key = 'collection' | append: i -%}
      {%- assign img_key  = 'image'      | append: i -%}
      {%- assign lbl_key  = 'label'      | append: i -%}
      {%- assign coll = collections[section.settings[coll_key]] -%}
      {% if coll != blank %}
      <a href="{{ coll.url }}" style="display:block;text-decoration:none;color:inherit;border-radius:12px;overflow:hidden;border:1px solid rgba(0,0,0,.08)">
        <div style="aspect-ratio:1;overflow:hidden;background:#f5f5f5">
          {% if section.settings[img_key] != blank %}
            <img src="{{ section.settings[img_key] | img_url: '600x600' }}" alt="{{ coll.title }}" loading="lazy" style="width:100%;height:100%;object-fit:cover">
          {% elsif coll.image %}
            <img src="{{ coll.image | img_url: '600x600' }}" alt="{{ coll.title }}" loading="lazy" style="width:100%;height:100%;object-fit:cover">
          {% endif %}
        </div>
        <div style="padding:.875rem">
          <p style="font-weight:700;margin:0 0 .2rem;font-size:.95rem">{{ section.settings[lbl_key] | default: coll.title }}</p>
          <p style="opacity:.6;margin:0;font-size:.8rem">Shop now &rarr;</p>
        </div>
      </a>
      {% endif %}
    {% endfor %}
  </div>
</div>`
}

function buildCollectionListSchema(heading: string, bg = '#ffffff') {
  const slots = [1, 2, 3, 4].flatMap(i => [
    { type: 'collection', id: `collection${i}`, label: `Collection ${i}` },
    { type: 'image_picker', id: `image${i}`, label: `Collection ${i} image (optional override)` },
    { type: 'text', id: `label${i}`, label: `Collection ${i} label (optional override)` },
  ])
  return {
    name: 'Collection List',
    settings: [
      ...(heading ? [setting({ type: 'text', id: 'heading', label: 'Section heading' }, heading)] : [{ type: 'text', id: 'heading', label: 'Section heading' }]),
      { type: 'range', id: 'columns', label: 'Columns', min: 2, max: 4, step: 1, default: 3 },
      ...slots,
      { type: 'color', id: 'bg_color', label: 'Background color', default: bg },
      { type: 'color', id: 'text_color', label: 'Text color', default: bg === '#ffffff' ? '#111111' : '#ffffff' },
    ],
    presets: [{ name: 'Collection List' }],
  }
}

// ── Product main Liquid ──────────────────────────────────────────────────────

function productMainLiquid(bg = '#ffffff'): string {
  const textColor = bg === '#ffffff' || bg === '#fff' ? '#111111' : '#ffffff'
  return `<div data-igualai-id="{{ section.id }}" style="background-color:{{ section.settings.bg_color }};color:{{ section.settings.text_color }};padding:{{ section.settings.section_padding }}px 2rem">
  <div style="max-width:1280px;margin:0 auto;display:flex;flex-wrap:wrap;gap:3rem;align-items:flex-start">

    {%- comment -%}── Product gallery ─────────────────────────────────────{%- endcomment -%}
    <div style="flex:1;min-width:280px">
      <div style="aspect-ratio:1;overflow:hidden;border-radius:12px;background:#f5f5f5;margin-bottom:.75rem">
        <img id="igualai-main-img-{{ section.id }}"
          src="{{ product.featured_image | img_url: 'master' }}"
          alt="{{ product.title | escape }}"
          style="width:100%;height:100%;object-fit:cover;display:block">
      </div>
      {% if product.images.size > 1 %}
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        {% for image in product.images limit: 6 %}
        <button type="button"
          onclick="document.getElementById('igualai-main-img-{{ section.id }}').src='{{ image | img_url: '800x800' }}'"
          style="width:calc(16.666% - .5rem);aspect-ratio:1;overflow:hidden;border-radius:6px;cursor:pointer;border:2px solid transparent;padding:0;background:none">
          <img src="{{ image | img_url: '120x120', crop: 'center' }}" alt="{{ product.title | escape }}" style="width:100%;height:100%;object-fit:cover;display:block">
        </button>
        {% endfor %}
      </div>
      {% endif %}
    </div>

    {%- comment -%}── Product info ─────────────────────────────────────────{%- endcomment -%}
    <div style="flex:1;min-width:280px">
      {% if product.vendor != blank %}
      <p style="font-size:.8rem;text-transform:uppercase;letter-spacing:.1em;opacity:.55;margin:0 0 .5rem">{{ product.vendor }}</p>
      {% endif %}
      <h1 style="font-size:clamp(1.5rem,3vw,2.25rem);font-weight:800;margin:0 0 1rem;line-height:1.15;font-family:var(--font-heading,inherit)">{{ product.title }}</h1>

      <div style="margin-bottom:1.5rem;display:flex;align-items:baseline;gap:.75rem">
        <span id="igualai-price-{{ section.id }}" style="font-size:1.75rem;font-weight:700">
          {{ product.selected_or_first_available_variant.price | money }}
        </span>
        {% if product.compare_at_price > product.price %}
        <span style="font-size:1rem;text-decoration:line-through;opacity:.45">
          {{ product.compare_at_price | money }}
        </span>
        <span style="font-size:.8rem;font-weight:700;color:#e53e3e;background:#fff5f5;padding:.2rem .5rem;border-radius:4px">
          SALE
        </span>
        {% endif %}
      </div>

      {% form 'product', product, id: 'igualai-product-form-{{ section.id }}', novalidate: true %}
        <input type="hidden" name="id" id="igualai-variant-id-{{ section.id }}"
          value="{{ product.selected_or_first_available_variant.id }}">

        {% unless product.has_only_default_variant %}
          {% for option in product.options_with_values %}
          <div style="margin-bottom:1rem">
            <label style="display:block;font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.7;margin-bottom:.375rem">
              {{ option.name }}
            </label>
            <div style="display:flex;flex-wrap:wrap;gap:.5rem" data-option-index="{{ forloop.index0 }}">
              {% for value in option.values %}
              <button type="button"
                class="igualai-opt-{{ section.id }}-{{ forloop.parentloop.index0 }}"
                data-value="{{ value }}"
                style="padding:.4rem .9rem;border:1.5px solid rgba(0,0,0,.2);border-radius:.375rem;font-size:.875rem;cursor:pointer;background:transparent;color:inherit;transition:border-color .15s">
                {{ value }}
              </button>
              {% endfor %}
            </div>
          </div>
          {% endfor %}
        {% endunless %}

        <button type="submit" name="add"
          {% unless product.available %}disabled{% endunless %}
          style="width:100%;padding:.9rem 1.5rem;margin-top:.75rem;background:var(--color-button,#111);color:var(--color-button-text,#fff);border:none;border-radius:.5rem;font-size:1rem;font-weight:700;cursor:pointer;letter-spacing:.04em;transition:opacity .15s;{% unless product.available %}opacity:.5;cursor:not-allowed;{% endunless %}">
          {% if product.available %}
            {{ section.settings.add_to_cart_text }}
          {% else %}
            {{ section.settings.sold_out_text }}
          {% endif %}
        </button>
      {% endform %}

      {% if product.description != blank %}
      <div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid rgba(128,128,128,.15);font-size:.9375rem;line-height:1.75;opacity:.85">
        {{ product.description }}
      </div>
      {% endif %}
    </div>
  </div>
</div>

<script>
(function() {
  var sid = {{ section.id | json }};
  var variants = {{ product.variants | json }};
  var numOptions = {{ product.options.size }};
  var selected = {};

  // Pre-select first value of each option
  for (var i = 0; i < numOptions; i++) {
    var btns = document.querySelectorAll('.igualai-opt-' + sid + '-' + i);
    if (btns.length) { selected[i] = btns[0].getAttribute('data-value'); styleBtn(btns[0], true); }
  }

  function styleBtn(btn, active) {
    btn.style.borderColor = active ? 'var(--color-button,#111)' : 'rgba(0,0,0,.2)';
    btn.style.fontWeight = active ? '700' : 'normal';
  }

  for (var oi = 0; oi < numOptions; oi++) {
    (function(optIndex) {
      var btns = document.querySelectorAll('.igualai-opt-' + sid + '-' + optIndex);
      btns.forEach(function(btn) {
        btn.addEventListener('click', function() {
          btns.forEach(function(b) { styleBtn(b, false); });
          styleBtn(btn, true);
          selected[optIndex] = btn.getAttribute('data-value');
          updateVariant();
        });
      });
    })(oi);
  }

  function updateVariant() {
    var variant = variants.find(function(v) {
      return v.options.every(function(opt, i) { return opt === selected[i]; });
    });
    if (!variant) return;
    var idInput = document.getElementById('igualai-variant-id-' + sid);
    if (idInput) idInput.value = variant.id;
    var priceEl = document.getElementById('igualai-price-' + sid);
    if (priceEl && variant.price != null) {
      priceEl.textContent = formatMoney(variant.price);
    }
    var addBtn = document.querySelector('#igualai-product-form-' + sid + ' button[name="add"]');
    if (addBtn) {
      if (variant.available) {
        addBtn.disabled = false; addBtn.style.opacity = '1';
        addBtn.textContent = {{ section.settings.add_to_cart_text | json }};
      } else {
        addBtn.disabled = true; addBtn.style.opacity = '.5';
        addBtn.textContent = {{ section.settings.sold_out_text | json }};
      }
    }
  }

  function formatMoney(cents) {
    return '$' + (cents / 100).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  }
})();
</script>`
}

function buildProductMainSchema(bg = '#ffffff') {
  const textColor = bg === '#ffffff' || bg === '#fff' ? '#111111' : '#ffffff'
  return {
    name: 'Product',
    tag: 'section',
    settings: [
      { type: 'text', id: 'add_to_cart_text', label: 'Add to cart button text', default: 'Add to Cart' },
      { type: 'text', id: 'sold_out_text', label: 'Sold out button text', default: 'Sold Out' },
      { type: 'range', id: 'section_padding', label: 'Section padding', min: 20, max: 120, step: 4, default: 60, unit: 'px' },
      { type: 'color', id: 'bg_color', label: 'Background color', default: bg },
      { type: 'color', id: 'text_color', label: 'Text color', default: textColor },
    ],
    presets: [{ name: 'Product' }],
  }
}

// ── Header/Footer section builders ───────────────────────────────────────────

function buildHeaderSection(announcementHtml: string, navHtml: string): { liquid: string; defaults: Record<string, string> } {
  const d: Record<string, string> = {}

  // Extract announcement bar text for default
  if (announcementHtml) {
    const $a = load(announcementHtml)
    d.announcement_text = $a('body').text().trim().slice(0, 255)
    const bgMatch = announcementHtml.match(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,6}|rgb[^;)"]+)/i)
    if (bgMatch) d.announcement_bg = bgMatch[1]
  }

  // Replace the first <img> in the nav (the logo) with a Liquid image_picker variable.
  // Falls back to shop.name text if no logo is uploaded in the Shopify editor.
  if (navHtml) {
    const $nav = load(navHtml)
    const logoImg = $nav('img').first()
    if (logoImg.length) {
      const existingStyle = logoImg.attr('style') ?? ''
      const heightStyle = existingStyle.match(/(?:max-)?height\s*:[^;]+/i)?.[0] ?? 'max-height:50px'
      logoImg.replaceWith(
        `{% if section.settings.logo != blank %}<img src="{{ section.settings.logo | img_url: '300x' }}" alt="{{ shop.name }}" style="${heightStyle};width:auto;display:inline-block">{% else %}<span style="font-weight:700;font-size:1.1rem;letter-spacing:.02em">{{ shop.name }}</span>{% endif %}`
      )
      navHtml = $nav('body').html() ?? navHtml
    }
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

function buildFooterSection(rawFooterHtml: string): string {
  // Strip inline scripts — they can break Liquid parsing and aren't needed in Shopify
  const cleanHtml = rawFooterHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')

  // Replace any email subscribe <form> with a Shopify-native contact form so the
  // newsletter actually works when pushed to Shopify.
  const hasEmailForm = /type=["']email["']|placeholder=["'][^"']*email/i.test(cleanHtml)
  let footerHtml = cleanHtml
  if (hasEmailForm) {
    footerHtml = footerHtml.replace(
      /<form[^>]*>[\s\S]*?<\/form>/gi,
      `{%- form 'customer', class: 'igualai-footer-form' -%}
        <input type="hidden" name="contact[tags]" value="newsletter">
        {%- if form.posted_successfully? -%}
          <p style="margin:0;font-size:.875rem;opacity:.8">Thanks for subscribing!</p>
        {%- else -%}
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <input type="email" name="contact[email]" placeholder="Enter your email" required
              style="padding:.5rem 1rem;border-radius:.375rem;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;font-size:.875rem;min-width:180px">
            <button type="submit"
              style="padding:.5rem 1.25rem;border-radius:.375rem;background:var(--color-button,#111);color:var(--color-button-text,#fff);border:none;cursor:pointer;font-weight:600;font-size:.875rem">
              Subscribe
            </button>
          </div>
        {%- endif -%}
      {%- endform -%}`
    )
  }

  const bg = detectBgColor(rawFooterHtml) || '#000000'
  const isDark = /^#(?:0[0-9a-f]|1[0-5][0-9a-f]|2[0-3])/i.test(bg) || bg === '#000000'
  const textDefault = isDark ? '#ffffff' : '#111111'

  // Embed the actual designed footer HTML directly — this guarantees visual fidelity
  // without requiring Theme Editor configuration. Color overrides are available in settings.
  const schema = {
    name: 'Footer',
    class: 'section-footer',
    settings: [
      { type: 'color', id: 'bg_color', label: 'Background color', default: bg },
      { type: 'color', id: 'text_color', label: 'Text color', default: textDefault },
    ],
  }

  return footerHtml + '\n' + schemaTag(schema)
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function htmlToShopifySections(html: string, sectionPrefix = '', pageType?: string): Promise<ShopifySections> {
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
  // Priority 1: use data-igualai-section markers set by Gemini during brand rebuild.
  // Gemini may wrap all sections inside a single container div; querying for marked
  // elements directly gives correct sections even in that case.
  const allMarked = $('[data-igualai-section]').toArray()
  // Keep only top-level markers — skip any nested inside another marked element.
  const markedEls = allMarked.filter(el => {
    let parent = $(el).parent()
    while (parent.length && !parent.is('html')) {
      if (parent.attr('data-igualai-section')) return false
      parent = parent.parent()
    }
    return true
  })

  const rawChunks: string[] = []

  if (markedEls.length >= 2) {
    for (const el of markedEls) {
      const elHtml = $.html(el) ?? ''
      if (elHtml.length > 50) rawChunks.push(elHtml)
    }
  } else {
    // Priority 2: split body's direct children by semantic block elements
    const bodyChildren = $('body').children().toArray()
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
  }

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
    const type = classifySection(chunkHtml, i === 0, pageType)

    if (type === 'announcement-bar') {
      announcementBarHtml = chunkHtml
      continue
    }

    usedNames[type] = (usedNames[type] ?? 0) + 1
    const baseName = usedNames[type] === 1 ? type : `${type}-${usedNames[type]}`
    const name = sectionPrefix ? `${sectionPrefix}-${baseName}` : baseName
    const imgCount = countImages(chunkHtml)

    let sectionContent = ''
    const bg = detectBgColor(chunkHtml)

    if (type === 'hero') {
      const { liquid, defaults } = liquidifyHero(chunkHtml)
      sectionContent = injectColorVars(liquid) + schemaTag(buildHeroSchema(defaults, bg))
    } else if (type === 'collection-list') {
      const $c = load(chunkHtml)
      const heading = $c('h2, h3').first().text().trim()
      sectionContent = injectColorVars(collectionListLiquid(heading)) + schemaTag(buildCollectionListSchema(heading, bg))
    } else if (type === 'product-main') {
      sectionContent = productMainLiquid(bg) + schemaTag(buildProductMainSchema(bg))
    } else if (type === 'product-grid') {
      const $c = load(chunkHtml)
      const heading = $c('h2, h3').first().text().trim()
      if (pageType === 'collection') {
        // Collection pages: dynamic Shopify product loop using built-in `collection` variable
        sectionContent = injectColorVars(productGridLiquid(heading, true)) + schemaTag(buildProductGridSchema({ heading }, bg))
      } else {
        // Homepage / other pages: render the IgualAI-designed product cards as static HTML.
        // A dynamic loop would show "Select a collection in the sidebar" until configured.
        // Static rendering preserves the brand design immediately on push.
        const { liquid, defaults } = liquidifyContent(chunkHtml)
        sectionContent = injectColorVars(liquid) + schemaTag(buildContentSchema('Featured Products', { heading: heading || defaults.heading || '', subheading: defaults.subheading || '' }, imgCount >= 2, bg))
      }
    } else if (type === 'newsletter') {
      const { liquid, defaults } = liquidifyHero(chunkHtml)
      sectionContent = injectColorVars(liquid) + schemaTag({
        name: 'Newsletter',
        settings: [
          setting({ type: 'text', id: 'heading', label: 'Heading' }, defaults.heading),
          setting({ type: 'text', id: 'btn1_label', label: 'Button text' }, defaults.btn1_label),
          { type: 'color', id: 'bg_color', label: 'Background color', default: bg },
          { type: 'color', id: 'text_color', label: 'Text color', default: bg === '#ffffff' ? '#111111' : '#ffffff' },
        ],
        presets: [{ name: 'Newsletter' }],
      })
    } else {
      const { liquid, defaults } = liquidifyContent(chunkHtml)
      const displayName = type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, ' ')
      sectionContent = injectColorVars(liquid) + schemaTag(buildContentSchema(displayName, defaults, imgCount >= 2, bg))
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
