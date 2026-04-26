export interface ShopifyTheme {
  id: number
  name: string
  role: string
}

export async function deployToShopify(
  shopDomain: string,
  accessToken: string,
  htmlContent: string,
  themeName: string = 'CloneAI Theme'
): Promise<{ themeId: number; previewUrl: string }> {
  const baseUrl = `https://${shopDomain}/admin/api/2024-01`

  // Create a new theme
  const themeResponse = await fetch(`${baseUrl}/themes.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      theme: {
        name: themeName,
        role: 'unpublished',
      },
    }),
  })

  if (!themeResponse.ok) {
    const error = await themeResponse.json()
    throw new Error(error.errors || 'Failed to create Shopify theme')
  }

  const { theme } = await themeResponse.json()

  // Upload the HTML as the main template
  const assetResponse = await fetch(`${baseUrl}/themes/${theme.id}/assets.json`, {
    method: 'PUT',
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      asset: {
        key: 'layout/theme.liquid',
        value: htmlContent,
      },
    }),
  })

  if (!assetResponse.ok) {
    throw new Error('Failed to upload theme asset')
  }

  return {
    themeId: theme.id,
    previewUrl: `https://${shopDomain}?preview_theme_id=${theme.id}`,
  }
}
