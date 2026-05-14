/**
 * shopify-sectioner — converts a static HTML clone into Shopify liquid sections
 *
 * Uses Gemini to identify visual sections in the HTML, generate proper
 * .liquid files with {% schema %} blocks, and replace static product grids
 * with real Shopify Liquid loops tied to a collection picker.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'

function getClient() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  return new GoogleGenerativeAI(key)
}

export interface ShopifySections {
  /** section name → liquid file content (includes {% schema %} block) */
  sections: Record<string, string>
  /** ordered list of section names for templates/index.liquid */
  order: string[]
}

/**
 * Takes the full HTML of a cloned page and returns Shopify liquid sections.
 * Each section is a self-contained .liquid file ready to upload to Shopify.
 */
export async function htmlToShopifySections(html: string): Promise<ShopifySections> {
  const client = getClient()
  const model = client.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  })

  // Strip <style> blocks from HTML to reduce token usage — CSS stays in assets/style.css
  const stripped = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Cap at 400KB to stay within token limits
  const MAX_CHARS = 400_000
  const truncated = stripped.length > MAX_CHARS
    ? stripped.slice(0, stripped.lastIndexOf('>', MAX_CHARS) + 1) + '\n<!-- truncated -->'
    : stripped

  const prompt = `You are a Shopify theme developer. Convert this cloned website HTML into proper Shopify liquid sections so it becomes fully editable in the Shopify theme editor.

RULES:
1. Identify 4-8 distinct visual sections (e.g. announcement-bar, header, hero, product-grid, features, lifestyle, testimonials, footer).
2. For each section, output its HTML content as a Shopify liquid section file.
3. Every section file MUST end with a {% schema %} block that defines:
   - "name": display name shown in Shopify editor
   - "settings": array of editable settings relevant to that section (text fields for headings, color pickers for backgrounds, image pickers for images, etc.)
   - "presets": [{"name": "<section name>"}]
4. For ANY section that shows a grid of products/cards, replace the static product HTML with a real Shopify Liquid loop:

   {% assign collection = collections[section.settings.collection] %}
   {% if collection != blank %}
     {% for product in collection.products limit: section.settings.products_to_show %}
       <a href="{{ product.url }}">
         <img src="{{ product.featured_image | img_url: '400x400' }}" alt="{{ product.title }}">
         <p>{{ product.title }}</p>
         <p>{{ product.price | money }}</p>
         <button>Add to Cart</button>
       </a>
     {% endfor %}
   {% else %}
     <p>Select a collection in the theme editor to show products.</p>
   {% endif %}

   And add these settings to the product grid schema:
   {"type":"collection","id":"collection","label":"Collection"}
   {"type":"range","id":"products_to_show","min":2,"max":12,"step":1,"default":6,"label":"Products to show"}

5. Keep ALL original styling (classes, inline styles) intact in each section.
6. Do NOT include <html>, <head>, or <body> tags in sections — just the inner content.
7. Section names must be lowercase with hyphens only (e.g. "hero", "product-grid", "lifestyle-strip").

HTML TO CONVERT:
${truncated}

Respond with ONLY valid JSON in this exact shape:
{
  "order": ["announcement-bar", "header", "hero", "product-grid", "footer"],
  "sections": {
    "announcement-bar": "<full liquid content for this section including {% schema %} block>",
    "header": "<full liquid content>",
    "hero": "<full liquid content>",
    "product-grid": "<full liquid content with real Liquid product loop>",
    "footer": "<full liquid content>"
  }
}`

  const result = await model.generateContent(prompt)
  const text = result.response.text()

  let parsed: ShopifySections
  try {
    parsed = JSON.parse(text)
  } catch {
    // Try to extract JSON if wrapped in markdown
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('Gemini returned invalid JSON for sections')
    parsed = JSON.parse(match[0])
  }

  if (!parsed.sections || !parsed.order) {
    throw new Error('Gemini response missing sections or order')
  }

  return parsed
}
