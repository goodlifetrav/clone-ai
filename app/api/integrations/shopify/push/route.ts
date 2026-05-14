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
      .select('html_content, name, user_id')
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

    // Use Gemini to convert HTML into editable Shopify sections
    const { htmlToShopifySections } = await import('@/lib/shopify-sectioner')
    console.log(`[Shopify] Sectioning HTML for project ${projectId}...`)
    const { sections, order } = await htmlToShopifySections(project.html_content)
    console.log(`[Shopify] Generated ${order.length} sections: ${order.join(', ')}`)

    // Build layout/theme.liquid
    const themeLiquid = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ page_title }} — {{ shop.name }}</title>
  {{ content_for_header }}
${headInner.trim()}
  {{ 'style.css' | asset_url | stylesheet_tag }}
</head>
<body>
  {{ content_for_layout }}
</body>
</html>`

    // Build templates/index.json (Shopify 2.0 format — lets editor add/remove/reorder sections)
    const sectionsJson: Record<string, unknown> = {}
    const sectionOrder: string[] = []

    for (const name of order) {
      if (!sections[name]) continue
      const id = `igualai-${name}`
      sectionsJson[id] = { type: name, disabled: false, settings: {} }
      sectionOrder.push(id)
    }

    const indexJson = JSON.stringify({
      sections: sectionsJson,
      order: sectionOrder,
    }, null, 2)

    // Assemble all theme files
    const themeFiles: Record<string, string> = {
      'layout/theme.liquid': themeLiquid,
      'templates/index.json': indexJson,
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
      ], null, 2),
    }

    // Add each section file
    for (const [name, content] of Object.entries(sections)) {
      themeFiles[`sections/${name}.liquid`] = content
    }

    // Create a new unpublished theme
    const themeData = await shopifyRequest(shopDomain, accessToken, 'POST', 'themes.json', {
      theme: {
        name: `IgualAI — ${project.name.slice(0, 40)}`,
        role: 'unpublished',
      },
    })
    const themeId = themeData.theme.id

    // Upload in dependency order: sections first, then templates that reference them
    const uploadOrder = [
      'layout/theme.liquid',
      'assets/style.css',
      'config/settings_schema.json',
      // sections must exist before templates/index.json references them
      ...Object.keys(themeFiles).filter(k => k.startsWith('sections/')),
      'templates/index.json',
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

    return NextResponse.json({ themeEditorUrl, themePreviewUrl, themeId })
  } catch (err) {
    const error = err as Error
    console.error('Shopify push error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
