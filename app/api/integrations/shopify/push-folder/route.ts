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
    } catch { /* fall through */ }
  }
  const lower = html.toLowerCase()
  if (lower.includes('add-to-cart') || lower.includes('add_to_cart') ||
      lower.includes('product-form') || (lower.includes('add to cart') && lower.includes('product'))) return 'product'
  if (lower.includes('collection-grid') || (lower.includes('collection') && lower.includes('filter'))) return 'collection'
  if (lower.includes('cart__items') || lower.includes('cart-form') ||
      (lower.includes('checkout') && lower.includes('cart'))) return 'cart'
  return 'index'
}

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
  console.log('[push-folder] request received')
  try {
    const { userId } = await getAuth()
    console.log('[push-folder] auth:', userId ? 'ok' : 'unauthorized')
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { folderId, shop, accessToken } = await request.json()
    console.log('[push-folder] params: folderId=%s shop=%s', folderId, shop)
    if (!folderId || !shop || !accessToken) {
      return NextResponse.json({ error: 'folderId, shop, and accessToken are required' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data: user } = await supabase
      .from('users')
      .select('id, plan, is_admin, email')
      .eq('clerk_id', userId)
      .single()
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { isAdminEmail } = await import('@/lib/admin')
    const allowedPlans = ['pro', 'growth', 'max']
    if (!user.is_admin && !isAdminEmail(user.email) && !allowedPlans.includes(user.plan)) {
      return NextResponse.json({ error: 'Shopify integration requires Pro plan or above.', upgradeRequired: true }, { status: 403 })
    }

    // Load folder and verify ownership
    const { data: folder } = await supabase
      .from('folders')
      .select('id, name, user_id')
      .eq('id', folderId)
      .single()
    if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    if (folder.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Load all projects in the folder
    const { data: projects } = await supabase
      .from('projects')
      .select('id, name, html_content, url')
      .eq('folder_id', folderId)
      .eq('user_id', user.id)
      .eq('status', 'complete')
    if (!projects || projects.length === 0) {
      return NextResponse.json({ error: 'No completed projects found in this folder.' }, { status: 400 })
    }

    const shopDomain = shop.replace(/^https?:\/\//, '').replace(/\/$/, '')
    if (!shopDomain.includes('.')) {
      return NextResponse.json({ error: 'Invalid shop domain' }, { status: 400 })
    }

    await shopifyRequest(shopDomain, accessToken, 'GET', 'shop.json')

    const { htmlToShopifySections } = await import('@/lib/shopify-sectioner')

    // Collect all theme files from all projects
    const allThemeFiles: Record<string, string> = {}
    const allCssParts: string[] = []
    let headInner = ''
    // Track how many times each page type appears for alternate template naming
    const pageTypeCounts: Record<string, number> = {}

    // Sort: index first, then others
    const sorted = [...projects].sort((a, b) => {
      const ta = detectPageType(a.url, a.html_content)
      const tb = detectPageType(b.url, b.html_content)
      if (ta === 'index') return -1
      if (tb === 'index') return 1
      return 0
    })

    for (const project of sorted) {
      const pageType = detectPageType(project.url, project.html_content)
      pageTypeCounts[pageType] = (pageTypeCounts[pageType] ?? 0) + 1
      const count = pageTypeCounts[pageType]

      // Alternate template name for duplicate page types (2nd collection = collection.alt-2, etc.)
      const tmplPath = pageType === 'index'
        ? 'templates/index.json'
        : count === 1
          ? `templates/${pageType}.json`
          : `templates/${pageType}.alt-${count}.json`

      const sectionPrefix = pageType === 'index' ? '' : count === 1 ? pageType : `${pageType}-${count}`

      const { css, headInner: hi } = extractStyles(project.html_content)
      if (css) allCssParts.push(`/* ${project.name} */\n${css}`)
      if (!headInner && hi) headInner = hi

      console.log(`[Shopify Folder] Processing "${project.name}" → ${tmplPath}`)
      const { sections, order, headerSectionName, footerSectionName, pageBg } = await htmlToShopifySections(project.html_content, sectionPrefix, pageType)

      // Add section files (prefixed names prevent collisions)
      for (const [name, content] of Object.entries(sections)) {
        allThemeFiles[`sections/${name}.liquid`] = content
      }

      // Build template JSON for this page
      const sectionsJson: Record<string, unknown> = {}
      const sectionOrder: string[] = []
      for (const name of order) {
        if (!sections[name]) continue
        const id = `igualai-${name}`
        sectionsJson[id] = { type: name, disabled: false, settings: {} }
        sectionOrder.push(id)
      }
      allThemeFiles[tmplPath] = JSON.stringify({ sections: sectionsJson, order: sectionOrder }, null, 2)

      // Only set header/footer + theme settings from the first (index) project
      if (pageType === 'index' || !allThemeFiles['layout/theme.liquid']) {
        allThemeFiles['layout/theme.liquid'] = buildThemeLiquid(headInner, headerSectionName, footerSectionName ?? '')
        allThemeFiles['config/settings_data.json'] = buildSettingsData(pageBg)
      }
    }

    // Shared CSS — merge all pages
    allThemeFiles['assets/style.css'] = allCssParts.join('\n\n') || '/* No styles extracted */'

    // Required Shopify theme files
    allThemeFiles['config/settings_schema.json'] = buildSettingsSchema(folder.name)
    // settings_data.json is set above from the index page's pageBg; ensure it exists as fallback
    if (!allThemeFiles['config/settings_data.json']) {
      allThemeFiles['config/settings_data.json'] = buildSettingsData('#ffffff')
    }
    allThemeFiles['templates/404.json'] = JSON.stringify({ sections: { main: { type: 'igualai-404', settings: {} } }, order: ['main'] }, null, 2)
    allThemeFiles['templates/password.json'] = JSON.stringify({ sections: { main: { type: 'igualai-password', settings: {} } }, order: ['main'] }, null, 2)
    allThemeFiles['sections/igualai-404.liquid'] = `<div style="text-align:center;padding:6rem 2rem">
  <h1 style="font-size:4rem;font-weight:800;margin:0 0 1rem">404</h1>
  <p style="font-size:1.2rem;opacity:.6;margin:0 0 2rem">Page not found</p>
  <a href="/" style="display:inline-block;padding:.75rem 2rem;background:#111;color:#fff;text-decoration:none;border-radius:.5rem;font-weight:600">← Back to home</a>
</div>
{% schema %}{"name":"404 page"}{% endschema %}`
    allThemeFiles['sections/igualai-password.liquid'] = `<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem">
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
    allThemeFiles['locales/en.default.json'] = JSON.stringify({
      general: { password_page: { login_form_heading: 'Enter store password', login_form_password_label: 'Password', login_form_password_placeholder: 'Your password', login_form_submit: 'Enter', powered_by_shopify_html: 'This store will be powered by {{ shopify }}' } },
    }, null, 2)

    // Create theme
    let themeData: { theme: { id: number } }
    try {
      themeData = await shopifyRequest(shopDomain, accessToken, 'POST', 'themes.json', {
        theme: { name: `IgualAI — ${folder.name.slice(0, 40)}`, role: 'unpublished' },
      })
    } catch (err) {
      const msg = (err as Error).message ?? ''
      if (msg.includes('422') || msg.toLowerCase().includes('limit') || msg.toLowerCase().includes('maximum')) {
        return NextResponse.json({
          error: 'Your Shopify store has reached the maximum number of themes. Please delete some unused themes at Shopify Admin → Online Store → Themes, then try again.',
          themeLimitReached: true,
        }, { status: 422 })
      }
      throw err
    }
    const themeId = themeData.theme.id

    // Upload order: layout → assets → config → locales → sections → templates
    const uploadOrder = [
      'layout/theme.liquid',
      'assets/style.css',
      'config/settings_schema.json',
      'config/settings_data.json',
      'locales/en.default.json',
      ...Object.keys(allThemeFiles).filter(k => k.startsWith('sections/')),
      ...Object.keys(allThemeFiles).filter(k => k.startsWith('templates/')),
    ]

    for (const key of uploadOrder) {
      const value = allThemeFiles[key]
      if (!value) continue
      await shopifyRequest(shopDomain, accessToken, 'PUT', `themes/${themeId}/assets.json`, {
        asset: { key, value },
      })
    }

    await supabase.from('shopify_connections').upsert(
      { user_id: user.id, shop: shopDomain, access_token: accessToken },
      { onConflict: 'user_id,shop' }
    )

    const pagesDeployed = Object.keys(allThemeFiles)
      .filter(k => k.startsWith('templates/') && k.endsWith('.json') && !['templates/404.json', 'templates/password.json'].includes(k))
      .map(k => k.replace('templates/', '').replace('.json', ''))

    return NextResponse.json({
      themeEditorUrl: `https://${shopDomain}/admin/themes/${themeId}/editor`,
      themePreviewUrl: `https://${shopDomain}/?preview_theme_id=${themeId}`,
      themeId,
      pagesDeployed,
    })
  } catch (err) {
    const error = err as Error
    console.error('Shopify folder push error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

function buildThemeLiquid(headInner: string, headerSectionName: string, footerSectionName: string): string {
  return `<!DOCTYPE html>
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
    h1,h2,h3,h4,h5,h6 { font-family: var(--font-heading); }
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
}

function buildSettingsSchema(folderName: string): string {
  return JSON.stringify([
    { name: 'theme_info', theme_name: folderName.slice(0, 25), theme_author: 'IgualAI', theme_version: '2.0.0', theme_support_url: 'https://igualai.com', theme_documentation_url: 'https://igualai.com/docs/shopify-integration' },
    { name: 'Colors', settings: [
      { type: 'color', id: 'primary_color', label: 'Primary color', default: '#000000' },
      { type: 'color', id: 'secondary_color', label: 'Secondary color', default: '#ffffff' },
      { type: 'color', id: 'accent_color', label: 'Accent color', default: '#4a90e2' },
      { type: 'color', id: 'button_color', label: 'Button color', default: '#1a5c3a' },
      { type: 'color', id: 'button_text_color', label: 'Button text color', default: '#ffffff' },
      { type: 'color', id: 'text_color', label: 'Body text color', default: '#111111' },
      { type: 'color', id: 'page_bg', label: 'Page background', default: '#ffffff' },
    ]},
    { name: 'Typography', settings: [
      { type: 'font_picker', id: 'heading_font', label: 'Heading font', default: 'helvetica_n4' },
      { type: 'font_picker', id: 'body_font', label: 'Body font', default: 'helvetica_n4' },
      { type: 'select', id: 'heading_size', label: 'Heading size', default: 'medium', options: [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }, { value: 'xlarge', label: 'Extra Large' }] },
      { type: 'range', id: 'body_font_size', label: 'Body font size', min: 12, max: 20, step: 1, default: 16, unit: 'px' },
    ]},
    { name: 'Spacing', settings: [
      { type: 'range', id: 'section_padding', label: 'Section vertical padding', min: 20, max: 120, step: 4, default: 60, unit: 'px' },
      { type: 'range', id: 'content_max_width', label: 'Content max width', min: 800, max: 1600, step: 80, default: 1280, unit: 'px' },
    ]},
  ], null, 2)
}

/** settings_data.json — seeds the actual current values for theme settings.
 *  Unlike settings_schema.json (which only defines defaults for the editor UI),
 *  settings_data.json stores the real values Shopify renders at runtime.
 *  We use this to set the page background to match the brand-rebuilt design. */
function buildSettingsData(pageBg: string): string {
  const isDark = pageBg !== '#ffffff' && pageBg !== '#fff'
  return JSON.stringify({
    current: {
      page_bg: pageBg,
      text_color: isDark ? '#ffffff' : '#111111',
    }
  }, null, 2)
}
