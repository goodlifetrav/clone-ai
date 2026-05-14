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

/** Detect the dominant background color of a section from inline styles or Tailwind classes */
function detectBgColor(html: string): string {
  const inline = html.match(/background(?:-color)?\s*:\s*(#[0-9a-f]{3,8})/i)
  if (inline) return inline[1]
  const arbitrary = html.match(/\bbg-\[#([0-9a-f]{3,8})\]/i)
  if (arbitrary) return `#${arbitrary[1]}`
  if (/\b(?:bg-black|bg-gray-9\d\d?|bg-neutral-9\d\d?|bg-zinc-9\d\d?|bg-slate-9\d\d?)\b/i.test(html)) return '#000000'
  if (/\b(?:bg-gray-8\d\d?|bg-neutral-8\d\d?)\b/i.test(html)) return '#1f2937'
  if (/\b(?:bg-gray-7\d\d?|bg-neutral-7\d\d?)\b/i.test(html)) return '#374151'
  return '#ffffff'
}

/** Inject bg_color and text_color Liquid vars using a scoped {% style %} block with !important.
 *  !important is required because child elements often have Tailwind text-* classes that
 *  would otherwise override inherited color values. */
function injectColorVars(html: string): string {
  const $ = load(html)
  const outer = $('body').children().first()

  // Scoped style block: attribute selector handles any characters in section.id safely.
  // Buttons with solid Tailwind bg-* classes get global --color-button so theme color picker works.
  // Outline/transparent buttons are excluded via :not([class*="bg-transparent"]).
  const styleBlock = `{%- style -%}
  [data-igualai-id="{{ section.id }}"] { background-color: {{ section.settings.bg_color }}; }
  [data-igualai-id="{{ section.id }}"] * { color: {{ section.settings.text_color }} !important; }
  [data-igualai-id="{{ section.id }}"] a[class*="bg-"]:not([class*="bg-transparent"]):not([class*="bg-white"]):not([class*="bg-opacity-0"]),
  [data-igualai-id="{{ section.id }}"] button[class*="bg-"]:not([class*="bg-transparent"]):not([class*="bg-white"]):not([class*="bg-opacity-0"]) { background-color: var(--color-button) !important; color: var(--color-button-text) !important; }
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

function classifySection(html: string, isFirst: boolean): string {
  // Check for explicit data-igualai-section attribute set by Gemini during brand rebuild
  const dataAttr = html.match(/data-igualai-section="([^"]+)"/i)?.[1]
  if (dataAttr) {
    const valid = ['announcement-bar', 'hero', 'product-grid', 'collection-list', 'testimonials', 'features', 'lifestyle', 'newsletter', 'content']
    if (valid.includes(dataAttr)) return dataAttr
  }

  const lower = html.toLowerCase()
  const textLen = html.replace(/<[^>]+>/g, '').trim().length
  const imgCount = countImages(html)

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

  // Product / content grid: multiple images or card children — check BEFORE hero
  // (hero sections have 0–1 large images; 3+ visual images = card/product grid)
  if (imgCount >= 3) return 'product-grid'

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
  // Detect newsletter heading from content before the email input
  let newsletterHeading = ''
  let subscribeBtn = 'Subscribe'
  const emailPos = rawFooterHtml.search(/type=["']email["']|placeholder=["'][^"']*email/i)
  if (emailPos > 0) {
    const headingMatches = [...rawFooterHtml.slice(0, emailPos).matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)]
    if (headingMatches.length > 0) {
      newsletterHeading = headingMatches[headingMatches.length - 1][1].replace(/<[^>]+>/g, '').trim()
    }
    const btnMatch = rawFooterHtml.match(/(<(?:button|a)[^>]*>)([\s\S]*?SUBSCRIBE[\s\S]*?)(<\/(?:button|a)>)/i)
    if (btnMatch) subscribeBtn = btnMatch[2].trim()
  }

  // Detect footer background color
  const bg = detectBgColor(rawFooterHtml) || '#000000'
  const isDark = /^#(?:0[0-9a-f]|1[0-5][0-9a-f]|2[0-3])/i.test(bg) || bg === '#000000'
  const textDefault = isDark ? '#ffffff' : '#111111'

  // Build a fully Liquid-powered footer — nav columns render from link_list settings
  // so users can edit/replace menus directly in the Shopify theme editor.
  const colStyle = 'style="display:inline-block;vertical-align:top;min-width:140px;margin-right:2rem;margin-bottom:1.5rem"'
  const navColLiquid = (menuId: string) => `
  {%- assign _nav = linklists[section.settings.${menuId}] -%}
  {% if _nav.links.size > 0 %}
  <div ${colStyle}>
    <h4 style="font-weight:700;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;margin:0 0 .75rem;opacity:.65">{{ _nav.title }}</h4>
    <ul style="list-style:none;padding:0;margin:0">
      {% for _link in _nav.links %}
      <li style="margin-bottom:.4rem"><a href="{{ _link.url }}" style="color:inherit;text-decoration:none;font-size:.875rem;opacity:.8">{{ _link.title }}</a></li>
      {% endfor %}
    </ul>
  </div>
  {% endif %}`

  const liquid = `<footer style="background-color:{{ section.settings.bg_color }};color:{{ section.settings.text_color }};padding:3rem 2rem 2rem">

  {% if section.settings.newsletter_heading != blank %}
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;padding-bottom:2rem;margin-bottom:2rem;border-bottom:1px solid rgba(128,128,128,.3)">
    <h2 style="font-size:1.4rem;font-weight:700;margin:0;letter-spacing:.04em">{{ section.settings.newsletter_heading }}</h2>
    <form method="post" action="/contact#ContactFooter" accept-charset="UTF-8" style="display:flex;gap:.5rem;flex-wrap:wrap">
      <input type="hidden" name="form_type" value="customer">
      <input type="hidden" name="utf8" value="✓">
      <input type="email" name="contact[email]" placeholder="Enter your email" required
        style="padding:.5rem 1rem;border-radius:.375rem;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;font-size:.875rem;min-width:180px">
      <button type="submit"
        style="padding:.5rem 1.25rem;border-radius:.375rem;background:{{ section.settings.btn_color }};color:{{ section.settings.btn_text_color }};border:none;cursor:pointer;font-weight:600;font-size:.875rem">
        {{ section.settings.subscribe_btn }}
      </button>
    </form>
  </div>
  {% endif %}

  <div style="margin-bottom:2rem">
    {% if section.settings.logo != blank or section.settings.brand_text != blank %}
    <div style="display:inline-block;vertical-align:top;min-width:180px;margin-right:2.5rem;margin-bottom:1.5rem;max-width:240px">
      {% if section.settings.logo != blank %}
        <img src="{{ section.settings.logo | img_url: '200x' }}" alt="{{ shop.name }}" style="max-height:50px;width:auto;margin-bottom:.75rem;display:block">
      {% endif %}
      {% if section.settings.brand_text != blank %}
        <p style="font-weight:700;font-size:1rem;margin:0 0 .375rem">{{ section.settings.brand_text }}</p>
      {% endif %}
      {% if section.settings.brand_description != blank %}
        <p style="font-size:.8rem;opacity:.65;margin:0;line-height:1.5">{{ section.settings.brand_description }}</p>
      {% endif %}
    </div>
    {% endif %}
    ${navColLiquid('menu1')}${navColLiquid('menu2')}${navColLiquid('menu3')}
  </div>

  <div style="padding-top:1.25rem;border-top:1px solid rgba(128,128,128,.3);font-size:.75rem;opacity:.55">
    {{ section.settings.copyright | default: shop.name }}
  </div>

</footer>`

  const schema = {
    name: 'Footer',
    class: 'section-footer',
    settings: [
      { type: 'image_picker', id: 'logo', label: 'Footer logo' },
      { type: 'text', id: 'brand_text', label: 'Brand name / tagline' },
      { type: 'textarea', id: 'brand_description', label: 'Brand description (optional)' },
      ...(newsletterHeading ? [
        setting({ type: 'text', id: 'newsletter_heading', label: 'Newsletter heading' }, newsletterHeading),
        setting({ type: 'text', id: 'subscribe_btn', label: 'Subscribe button text' }, subscribeBtn),
        { type: 'color', id: 'btn_color', label: 'Subscribe button color', default: '#1a5c3a' },
        { type: 'color', id: 'btn_text_color', label: 'Subscribe button text color', default: '#ffffff' },
      ] : []),
      { type: 'link_list', id: 'menu1', label: 'Footer links column 1', default: 'footer' },
      { type: 'link_list', id: 'menu2', label: 'Footer links column 2' },
      { type: 'link_list', id: 'menu3', label: 'Footer links column 3' },
      { type: 'text', id: 'copyright', label: 'Copyright text' },
      { type: 'color', id: 'bg_color', label: 'Background color', default: bg },
      { type: 'color', id: 'text_color', label: 'Text color', default: textDefault },
    ],
  }

  return liquid + schemaTag(schema)
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function htmlToShopifySections(html: string, sectionPrefix = ''): Promise<ShopifySections> {
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
    } else if (type === 'product-grid') {
      const $c = load(chunkHtml)
      const heading = $c('h2, h3').first().text().trim()
      sectionContent = injectColorVars(productGridLiquid(heading)) + schemaTag(buildProductGridSchema({ heading }, bg))
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
