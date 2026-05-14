import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'

async function shopifyRequest(
  shop: string,
  accessToken: string,
  method: string,
  path: string,
  body?: unknown
) {
  const res = await fetch(`https://${shop}/admin/api/2024-01/${path}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Shopify API error ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

type ShopifyPageType = 'index' | 'product' | 'collection' | 'cart' | 'page' | 'blog' | 'article' | 'search'

/** Detect which Shopify template this page belongs to based on URL path + HTML content */
function detectPageType(url: string | null | undefined, html: string): ShopifyPageType {
  if (url) {
    try {
      const path = new URL(url).pathname.toLowerCase().replace(/\/$/, '')
      if (path === '' || path === '/') return 'index'
      if (path.startsWith('/products/') && path.split('/').length >= 3) return 'product'
      if (path.startsWith('/collections/') && path.split('/').length >= 3) return 'collection'
      if (path === '/cart') return 'cart'
      if (path.startsWith('/blogs/') && path.split('/').length >= 4) return 'article'
      if (path.startsWith('/blogs/')) return 'blog'
      if (path === '/search') return 'search'
      if (path.startsWith('/pages/') || path.startsWith('/page/')) return 'page'
    } catch {
      // fall through to content detection
    }
  }
  // Content-based fallback
  const lower = html.toLowerCase()
  if (lower.includes('add-to-cart') || lower.includes('add_to_cart') ||
      lower.includes('product-form') || lower.includes('product__price') ||
      (lower.includes('add to cart') && lower.includes('product'))) return 'product'
  if (lower.includes('collection-grid') || lower.includes('collection__products') ||
      (lower.includes('collection') && lower.includes('filter'))) return 'collection'
  if (lower.includes('cart__items') || lower.includes('cart-form') ||
      (lower.includes('checkout') && lower.includes('cart'))) return 'cart'
  return 'index'
}

/** Build the Shopify template JSON file path for a given page type */
function templatePath(pageType: ShopifyPageType): string {
  if (pageType === 'index') return 'templates/index.json'
  return `templates/${pageType}.json`
}

/** Extract all <style> content from HTML, returning { css, htmlWithoutStyles } */
function extractStyles(html: string): { css: string; headInner: string } {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)
  let headInner = headMatch ? headMatch[1] : ''
  const styleParts: string[] = []
  headInner = headInner.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
    styleParts.push(css)
    return ''
  })
  return { css: styleParts.join('\n\n'), headInner }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { projectId, shop, accessToken } = await request.json()

    if (!projectId || !shop || !accessToken) {
      return NextResponse.json(
        { error: 'projectId, shop, and accessToken are required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // Verify user and plan
    const { data: user } = await supabase
      .from('users')
      .select('id, plan, is_admin, email')
      .eq('clerk_id', userId)
      .single()

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { isAdminEmail } = await import('@/lib/admin')
    const allowedPlans = ['pro', 'growth', 'max']
    if (!user.is_admin && !isAdminEmail(user.email) && !allowedPlans.includes(user.plan)) {
      return NextResponse.json(
        { error: 'Shopify integration requires Pro plan or above.', upgradeRequired: true },
        { status: 403 }
      )
    }

    // Load project HTML
    const { data: project } = await supabase
      .from('projects')
      .select('html_content, name, user_id, url')
      .eq('id', projectId)
      .single()

    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Normalise shop domain
    const shopDomain = shop.replace(/^https?:\/\//, '').replace(/\/$/, '')
    if (!shopDomain.includes('.')) {
      return NextResponse.json({ error: 'Invalid shop domain' }, { status: 400 })
    }

    // Verify credentials
    await shopifyRequest(shopDomain, accessToken, 'GET', 'shop.json')

    // Extract CSS from HTML
    const { css, headInner } = extractStyles(project.html_content)

    // Detect which Shopify template this page belongs to
    const pageType = detectPageType((project as { url?: string }).url, project.html_content)
    const tmplPath = templatePath(pageType)
    console.log(`[Shopify] Detected page type: ${pageType} → ${tmplPath}`)

    // Use Gemini to convert HTML into editable Shopify sections.
    // Prefix section names with page type (except index) to prevent collisions when
    // multiple pages from the same site are pushed into the same theme.
    const { htmlToShopifySections } = await import('@/lib/shopify-sectioner')
    const sectionPrefix = pageType === 'index' ? '' : pageType
    console.log(`[Shopify] Sectioning HTML for project ${projectId}...`)
    const { sections, order, headerSectionName, footerSectionName } = await htmlToShopifySections(project.html_content, sectionPrefix)
    console.log(`[Shopify] Generated ${order.length} body sections: ${order.join(', ')}`)

    // layout/theme.liquid uses {% section %} tags for header/footer so they are
    // editable static sections that appear on every page in the Shopify editor.
    const themeLiquid = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ page_title }} — {{ shop.name }}</title>
  {{ content_for_header }}
${headInner.trim()}
  {{ 'style.css' | asset_url | stylesheet_tag }}
  <style>
    {{ settings.heading_font | font_face }}
    {{ settings.body_font | font_face }}
    :root {
      --color-primary: {{ settings.primary_color }};
      --color-secondary: {{ settings.secondary_color }};
      --color-accent: {{ settings.accent_color }};
      --color-button: {{ settings.button_color }};
      --color-button-text: {{ settings.button_text_color }};
      --color-text: {{ settings.text_color }};
      --color-page-bg: {{ settings.page_bg }};
      --font-heading: {{ settings.heading_font.family }}, {{ settings.heading_font.fallback_families }};
      --font-body: {{ settings.body_font.family }}, {{ settings.body_font.fallback_families }};
      --font-size-body: {{ settings.body_font_size }}px;
      --section-padding: {{ settings.section_padding }}px;
      --content-max-width: {{ settings.content_max_width }}px;
      {% case settings.heading_size %}
        {% when 'small' %}--font-size-h1:2rem;--font-size-h2:1.5rem;--font-size-h3:1.25rem;
        {% when 'large' %}--font-size-h1:3.5rem;--font-size-h2:2.5rem;--font-size-h3:2rem;
        {% when 'xlarge' %}--font-size-h1:5rem;--font-size-h2:3.5rem;--font-size-h3:2.5rem;
        {% else %}--font-size-h1:2.5rem;--font-size-h2:2rem;--font-size-h3:1.5rem;
      {% endcase %}
    }
    body { font-family: var(--font-body); font-size: var(--font-size-body); color: var(--color-text); background-color: var(--color-page-bg); }
    h1, h2, h3, h4, h5, h6 { font-family: var(--font-heading); }
    h1 { font-size: var(--font-size-h1); }
    h2 { font-size: var(--font-size-h2); }
    h3 { font-size: var(--font-size-h3); }
  </style>
</head>
<body>
  {% section '${headerSectionName}' %}
  {{ content_for_layout }}
  ${footerSectionName ? `{% section '${footerSectionName}' %}` : ''}
</body>
</html>`

    // Build template JSON (Shopify 2.0 format — lets editor add/remove/reorder sections)
    const sectionsJson: Record<string, unknown> = {}
    const sectionOrder: string[] = []

    for (const name of order) {
      if (!sections[name]) continue
      const id = `igualai-${name}`
      sectionsJson[id] = { type: name, disabled: false, settings: {} }
      sectionOrder.push(id)
    }

    const templateJson = JSON.stringify({
      sections: sectionsJson,
      order: sectionOrder,
    }, null, 2)

    // Assemble all theme files
    const themeFiles: Record<string, string> = {
      'layout/theme.liquid': themeLiquid,
      [tmplPath]: templateJson,
      'assets/style.css': css || '/* No styles extracted */',
      'config/settings_schema.json': JSON.stringify([
        {
          name: 'theme_info',
          theme_name: project.name.slice(0, 25),
          theme_author: 'IgualAI',
          theme_version: '2.0.0',
          theme_support_url: 'https://igualai.com',
          theme_documentation_url: 'https://igualai.com/docs/shopify-integration',
        },
        {
          name: 'Colors',
          settings: [
            { type: 'color', id: 'primary_color', label: 'Primary color', default: '#000000' },
            { type: 'color', id: 'secondary_color', label: 'Secondary color', default: '#ffffff' },
            { type: 'color', id: 'accent_color', label: 'Accent color', default: '#4a90e2' },
            { type: 'color', id: 'button_color', label: 'Button color', default: '#1a5c3a' },
            { type: 'color', id: 'button_text_color', label: 'Button text color', default: '#ffffff' },
            { type: 'color', id: 'text_color', label: 'Body text color', default: '#111111' },
            { type: 'color', id: 'page_bg', label: 'Page background', default: '#ffffff' },
          ],
        },
        {
          name: 'Typography',
          settings: [
            { type: 'font_picker', id: 'heading_font', label: 'Heading font', default: 'helvetica_n4' },
            { type: 'font_picker', id: 'body_font', label: 'Body font', default: 'helvetica_n4' },
            {
              type: 'select', id: 'heading_size', label: 'Heading size', default: 'medium',
              options: [
                { value: 'small', label: 'Small' },
                { value: 'medium', label: 'Medium' },
                { value: 'large', label: 'Large' },
                { value: 'xlarge', label: 'Extra Large' },
              ],
            },
            { type: 'range', id: 'body_font_size', label: 'Body font size', min: 12, max: 20, step: 1, default: 16, unit: 'px' },
          ],
        },
        {
          name: 'Spacing',
          settings: [
            { type: 'range', id: 'section_padding', label: 'Section vertical padding', min: 20, max: 120, step: 4, default: 60, unit: 'px' },
            { type: 'range', id: 'content_max_width', label: 'Content max width', min: 800, max: 1600, step: 80, default: 1280, unit: 'px' },
          ],
        },
      ], null, 2),
    }

    // Required theme files — Shopify shows errors on 404/password pages without these
    themeFiles['templates/404.json'] = JSON.stringify({
      sections: { main: { type: 'igualai-404', settings: {} } }, order: ['main'],
    }, null, 2)
    themeFiles['templates/password.json'] = JSON.stringify({
      sections: { main: { type: 'igualai-password', settings: {} } }, order: ['main'],
    }, null, 2)
    themeFiles['sections/igualai-404.liquid'] = `<div style="text-align:center;padding:6rem 2rem">
  <h1 style="font-size:4rem;font-weight:800;margin:0 0 1rem">404</h1>
  <p style="font-size:1.2rem;opacity:.6;margin:0 0 2rem">Page not found</p>
  <a href="/" style="display:inline-block;padding:.75rem 2rem;background:#111;color:#fff;text-decoration:none;border-radius:.5rem;font-weight:600">← Back to home</a>
</div>
{% schema %}{"name":"404 page"}{% endschema %}`
    themeFiles['sections/igualai-password.liquid'] = `<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem">
  <h1 style="font-size:2rem;font-weight:700;margin:0 0 .5rem">{{ shop.name }}</h1>
  {% if shop.password_message != blank %}<p style="opacity:.6;margin:0 0 2rem">{{ shop.password_message }}</p>{% endif %}
  {% form 'storefront_password' %}
    <div style="display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap">
      <input type="password" name="password" placeholder="Enter password" style="padding:.625rem 1rem;border:1px solid #ddd;border-radius:.375rem;font-size:1rem;min-width:200px">
      <button type="submit" style="padding:.625rem 1.5rem;background:var(--color-button,#111);color:var(--color-button-text,#fff);border:none;border-radius:.375rem;font-size:1rem;cursor:pointer;font-weight:600">Enter</button>
    </div>
    {{ form.errors | default_errors }}
  {% endform %}
</div>
{% schema %}{"name":"Password page"}{% endschema %}`
    themeFiles['locales/en.default.json'] = JSON.stringify({
      general: { password_page: { login_form_heading: 'Enter store password', login_form_password_label: 'Password', login_form_password_placeholder: 'Your password', login_form_submit: 'Enter', powered_by_shopify_html: 'This store will be powered by {{ shopify }}' } },
    }, null, 2)

    // Add each section file
    for (const [name, content] of Object.entries(sections)) {
      themeFiles[`sections/${name}.liquid`] = content
    }

    // Create a new unpublished theme — detect theme limit exceeded (Shopify returns 422)
    let themeData: { theme: { id: number } }
    try {
      themeData = await shopifyRequest(shopDomain, accessToken, 'POST', 'themes.json', {
        theme: {
          name: `IgualAI — ${project.name.slice(0, 40)}`,
          role: 'unpublished',
        },
      })
    } catch (err) {
      const msg = (err as Error).message ?? ''
      if (msg.includes('422') || msg.toLowerCase().includes('limit') || msg.toLowerCase().includes('maximum')) {
        return NextResponse.json({
          error: 'Your Shopify store has reached the maximum number of themes (usually 20). Please delete some unused themes at Shopify Admin → Online Store → Themes, then try again.',
          themeLimitReached: true,
        }, { status: 422 })
      }
      throw err
    }
    const themeId = themeData.theme.id

    // Upload in dependency order: sections first, then templates that reference them
    const uploadOrder = [
      'layout/theme.liquid',
      'assets/style.css',
      'config/settings_schema.json',
      'locales/en.default.json',
      // sections must exist before any template JSON references them
      ...Object.keys(themeFiles).filter(k => k.startsWith('sections/')),
      tmplPath,
      'templates/404.json',
      'templates/password.json',
    ]

    for (const key of uploadOrder) {
      const value = themeFiles[key]
      if (!value) continue
      await shopifyRequest(shopDomain, accessToken, 'PUT', `themes/${themeId}/assets.json`, {
        asset: { key, value },
      })
    }

    // Save connection for future use
    await supabase.from('shopify_connections').upsert(
      { user_id: user.id, shop: shopDomain, access_token: accessToken },
      { onConflict: 'user_id,shop' }
    )

    const themeEditorUrl = `https://${shopDomain}/admin/themes/${themeId}/editor`
    const themePreviewUrl = `https://${shopDomain}/?preview_theme_id=${themeId}`

    return NextResponse.json({ themeEditorUrl, themePreviewUrl, themeId, pageType })
  } catch (err) {
    const error = err as Error
    console.error('Shopify push error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
