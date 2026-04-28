import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'

// Convert a self-contained HTML clone into a minimal Shopify theme structure.
// Returns an object keyed by the theme file path.
function buildShopifyTheme(html: string, projectName: string): Record<string, string> {
  // Extract <head> inner content (everything between <head> and </head>)
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)
  let headInner = headMatch ? headMatch[1] : ''

  // Extract <body> inner content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  const bodyInner = bodyMatch ? bodyMatch[1] : html

  // Pull out all <style> blocks — we'll put them in assets/style.css
  const styleParts: string[] = []
  headInner = headInner.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
    styleParts.push(css)
    return '' // remove from head
  })

  const css = styleParts.join('\n\n')

  const themeLiquid = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ shop.name }}</title>
  {{ content_for_header }}
${headInner.trim()}
  {{ 'style.css' | asset_url | stylesheet_tag }}
</head>
<body>
  {{ content_for_layout }}
</body>
</html>`

  const indexLiquid = `{% layout 'theme' %}
${bodyInner.trim()}`

  return {
    'layout/theme.liquid': themeLiquid,
    'templates/index.liquid': indexLiquid,
    'assets/style.css': css || '/* No styles extracted */',
    'config/settings_schema.json': JSON.stringify([
      {
        name: 'theme_info',
        theme_name: `IgualAI Clone — ${projectName}`,
        theme_author: 'IgualAI',
        theme_version: '1.0.0',
      },
    ], null, 2),
  }
}

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
    throw new Error(`Shopify API error ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
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

    const allowedPlans = ['pro', 'growth', 'max']
    if (!user.is_admin && !allowedPlans.includes(user.plan)) {
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

    // Verify credentials by fetching shop info
    await shopifyRequest(shopDomain, accessToken, 'GET', 'shop.json')

    // Build theme files
    const themeFiles = buildShopifyTheme(project.html_content, project.name)

    // Create a new unpublished theme
    const themeData = await shopifyRequest(shopDomain, accessToken, 'POST', 'themes.json', {
      theme: {
        name: `IgualAI — ${project.name}`,
        role: 'unpublished',
      },
    })
    const themeId = themeData.theme.id

    // Upload each theme file
    for (const [key, value] of Object.entries(themeFiles)) {
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
