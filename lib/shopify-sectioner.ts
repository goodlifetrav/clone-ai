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
 * Fallback: wrap the full body HTML in a single "content" section.
 * Used when Gemini fails or returns invalid JSON.
 */
function mechanicalFallback(html: string): ShopifySections {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const bodyInner = bodyMatch ? bodyMatch[1] : html

  const contentSection = `${bodyInner.trim()}

{% schema %}
{
  "name": "Page Content",
  "settings": [],
  "presets": [{"name": "Page Content"}]
}
{% endschema %}`

  return {
    order: ['content'],
    sections: { content: contentSection },
  }
}

/**
 * Takes the full HTML of a cloned page and returns Shopify liquid sections.
 * Each section is a self-contained .liquid file ready to upload to Shopify.
 */
export async function htmlToShopifySections(html: string): Promise<ShopifySections> {
  const client = getClient()

  // Strip <style> blocks and collapse whitespace to reduce token usage
  const stripped = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Cap at 300KB — large HTML causes Gemini to return HTML error pages
  const MAX_CHARS = 300_000
  const truncated = stripped.length > MAX_CHARS
    ? stripped.slice(0, stripped.lastIndexOf('>', MAX_CHARS) + 1) + '\n<!-- truncated -->'
    : stripped

  const prompt = `You are a Shopify theme developer. Convert this cloned website HTML into proper Shopify liquid sections so it becomes fully editable in the Shopify theme editor.

RULES:
1. Identify 4-8 distinct visual sections (e.g. announcement-bar, header, hero, product-grid, features, lifestyle, testimonials, footer).
2. For each section, output its HTML content as a Shopify liquid section file.
3. Every section file MUST end with a {% schema %} block defining "name", "settings" (editable fields like text, color, image), and "presets".
4. For ANY section showing a product grid, replace static product HTML with this Liquid loop:

{% assign collection = collections[section.settings.collection] %}
{% if collection != blank %}
  {% for product in collection.products limit: section.settings.products_to_show %}
    <a href="{{ product.url }}"><img src="{{ product.featured_image | img_url: '400x400' }}" alt="{{ product.title }}"><p>{{ product.title }}</p><p>{{ product.price | money }}</p></a>
  {% endfor %}
{% else %}
  <p style="padding:2rem;text-align:center">Select a collection in the theme editor to show products.</p>
{% endif %}

   Product grid schema settings must include:
   {"type":"collection","id":"collection","label":"Collection"} and {"type":"range","id":"products_to_show","min":2,"max":12,"step":1,"default":6,"label":"Products to show"}

5. Keep ALL original styling (classes, inline styles) intact.
6. Do NOT include html/head/body tags in sections.
7. Section names: lowercase with hyphens only.

HTML:
${truncated}

Return ONLY a JSON object with this exact shape (no markdown, no explanation):
{"order":["section-name",...],"sections":{"section-name":"<liquid content with schema block>"}}`

  try {
    // Use gemini-2.0-flash for reliable JSON — 2.5-flash can return HTML on large inputs
    const model = client.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    })

    const result = await model.generateContent(prompt)
    const text = result.response.text()

    // Guard: if Gemini returned HTML instead of JSON, use fallback
    if (text.trimStart().startsWith('<')) {
      console.warn('[Shopify] Gemini returned HTML — using mechanical fallback')
      return mechanicalFallback(html)
    }

    let parsed: ShopifySections
    try {
      parsed = JSON.parse(text)
    } catch {
      // Try to extract JSON from markdown code block
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) {
        console.warn('[Shopify] Could not parse Gemini JSON — using mechanical fallback')
        return mechanicalFallback(html)
      }
      parsed = JSON.parse(match[0])
    }

    if (!parsed.sections || !parsed.order || parsed.order.length === 0) {
      console.warn('[Shopify] Gemini returned empty sections — using mechanical fallback')
      return mechanicalFallback(html)
    }

    return parsed
  } catch (err) {
    console.error('[Shopify] Sectioner error, using mechanical fallback:', err)
    return mechanicalFallback(html)
  }
}
