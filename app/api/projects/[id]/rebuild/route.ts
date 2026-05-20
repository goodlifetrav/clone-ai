import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { chatWithProjectGemini } from '@/lib/gemini'
import { injectBrandImages } from '@/lib/image-injection'
import { extractHeaderFooter, replaceHeaderFooter } from '@/lib/header-footer'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { userId } = await getAuth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, plan, is_admin, email')
    .eq('clerk_id', userId)
    .single()

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { data: project } = await supabase
    .from('projects')
    .select('html_content, user_id, folder_id, url')
    .eq('id', id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const body = await request.json()
  const { brandName, tagline, primaryColor, secondaryColor, accentColor, logoUrl, brandDescription, headline, subheadline, ctaText, productName, productDescription, pageType } = body

  // Build a page-type-aware brand message
  let brandMessage: string
  if (pageType === 'product') {
    brandMessage = `Rebuild this PRODUCT PAGE for my brand:
- Brand Name: ${brandName}
- Tagline: ${tagline || ''}
- Primary Color: ${primaryColor}
- Secondary Color: ${secondaryColor || ''}
- Accent Color: ${accentColor || ''}
- Logo: ${logoUrl ? logoUrl : 'use brand name as text logo'}
- Brand Description: ${brandDescription}
${productName ? `- Product Name: ${productName}` : ''}
${productDescription ? `- Product Description: ${productDescription}` : ''}

THIS IS A PRODUCT PAGE. Keep the product detail layout (image on left, title/price/add-to-cart on right). Style supporting sections with brand colors and copy. Do NOT generate a homepage hero.`
  } else if (pageType === 'collection') {
    brandMessage = `Rebuild this COLLECTION PAGE for my brand:
- Brand Name: ${brandName}
- Tagline: ${tagline || ''}
- Primary Color: ${primaryColor}
- Secondary Color: ${secondaryColor || ''}
- Accent Color: ${accentColor || ''}
- Logo: ${logoUrl ? logoUrl : 'use brand name as text logo'}
- Brand Description: ${brandDescription}

THIS IS A COLLECTION PAGE. Keep the product grid layout. Style the page with brand colors and copy.`
  } else if (pageType === 'cart') {
    brandMessage = `Rebuild this CART PAGE for my brand:
- Brand Name: ${brandName}
- Tagline: ${tagline || ''}
- Primary Color: ${primaryColor}
- Secondary Color: ${secondaryColor || ''}
- Accent Color: ${accentColor || ''}
- Logo: ${logoUrl ? logoUrl : 'use brand name as text logo'}
- Brand Description: ${brandDescription}

THIS IS A CART PAGE. Keep the cart layout (items list + order summary). Style with brand colors. Do NOT generate a homepage hero.`
  } else {
    brandMessage = `Rebuild this website for my brand:
- Brand Name: ${brandName}
- Tagline: ${tagline || ''}
- Primary Color: ${primaryColor}
- Secondary Color: ${secondaryColor || ''}
- Accent Color: ${accentColor || ''}
- Logo: ${logoUrl ? logoUrl : 'use brand name as text logo'}
- Description: ${brandDescription}
- Hero Headline: ${headline || brandName}
- Hero Subheadline: ${subheadline || tagline || brandDescription}
- CTA Button Text: ${ctaText || 'Get Started'}

Keep the exact same layout, sections, and visual structure. Replace all text with brand-appropriate copy.`
  }

  // Load shared header/footer for non-homepage rebuilds so all pages match.
  // Priority: folder.brand_profile (set after a homepage rebuild) → rebuilt sibling
  // from the same domain (fallback when no folder, or folder has no saved profile yet).
  let sharedHeaderHtml: string | undefined
  let sharedFooterHtml: string | undefined
  if (pageType !== 'homepage') {
    // 1. Folder brand_profile (fastest path when homepage was already rebuilt)
    if (project.folder_id) {
      const { data: folder } = await supabase
        .from('folders')
        .select('brand_profile')
        .eq('id', project.folder_id)
        .single()
      sharedHeaderHtml = folder?.brand_profile?.headerHtml || undefined
      sharedFooterHtml = folder?.brand_profile?.footerHtml || undefined
    }

    // 2. Domain-based fallback: find any already-rebuilt page from this user + domain
    if (!sharedHeaderHtml && !sharedFooterHtml && project.url) {
      let domain = ''
      try { domain = new URL(project.url).hostname.replace(/^www\./, '') } catch { /* ignore */ }
      if (domain) {
        const { data: siblings } = await supabase
          .from('projects')
          .select('html_content')
          .eq('user_id', user.id)
          .neq('id', id)
          .ilike('url', `%${domain}%`)
          .not('html_content', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(5)

        for (const s of siblings ?? []) {
          if (!s.html_content?.includes('data-igualai-section')) continue
          const { headerHtml, footerHtml } = extractHeaderFooter(s.html_content)
          if (headerHtml || footerHtml) {
            sharedHeaderHtml = headerHtml || undefined
            sharedFooterHtml = footerHtml || undefined
            console.log(`[rebuild] Header/footer sourced from sibling project (domain fallback)`)
            break
          }
        }
      }
    }
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { /* client disconnected */ }
      }

      const keepalive = setInterval(() => send({ status: 'thinking' }), 3000)

      try {
        send({ status: 'thinking' })

        // Save the original clone as a labeled version before overwriting it.
        const existingVersions = await supabase
          .from('project_versions')
          .select('id')
          .eq('project_id', id)
          .limit(1)
        const hasNoVersions = !existingVersions.data || existingVersions.data.length === 0
        if (hasNoVersions && project.html_content) {
          const { data: latest } = await supabase
            .from('project_versions')
            .select('version_number')
            .eq('project_id', id)
            .order('version_number', { ascending: false })
            .limit(1)
            .single()
          const nextVersion = (latest?.version_number || 0) + 1
          await supabase.from('project_versions').insert({
            project_id: id,
            html_content: project.html_content,
            version_number: nextVersion,
            label: 'Original Clone',
          })
        }

        // Pass sharedHeader/Footer so Gemini uses the right brand colors/style,
        // then override its output with the exact source HTML post-generation.
        const { html: fullHtmlRaw } = await chatWithProjectGemini(
          project.html_content ?? '',
          [{ role: 'user', content: brandMessage }],
          undefined,
          pageType as string | undefined,
          sharedHeaderHtml,
          sharedFooterHtml
        )

        if (!fullHtmlRaw || !/<html/i.test(fullHtmlRaw) || !/<\/html>/i.test(fullHtmlRaw)) {
          send({ error: 'Gemini did not return valid HTML. Please try again.' })
          return
        }

        // Post-generation header/footer injection — surgically replace Gemini's
        // generated header/footer with the exact HTML from the source page.
        const fullHtmlSynced = (sharedHeaderHtml || sharedFooterHtml)
          ? replaceHeaderFooter(fullHtmlRaw, sharedHeaderHtml ?? '', sharedFooterHtml ?? '')
          : fullHtmlRaw
        if (sharedHeaderHtml || sharedFooterHtml) {
          console.log(`[rebuild] Post-injected shared header/footer`)
        }

        // ── Image generation ─────────────────────────────────────────────────
        send({ status: 'generating_images' })
        const fullHtml = await injectBrandImages(
          fullHtmlSynced,
          { brandName, brandDescription, primaryColor, secondaryColor, tagline },
          id,
          (current, total) => send({ status: 'generating_images', current, total })
        )

        // Save to DB
        await supabase
          .from('projects')
          .update({ html_content: fullHtml, updated_at: new Date().toISOString() })
          .eq('id', id)

        // After a homepage rebuild: save header/footer to folder AND immediately
        // propagate to all other already-rebuilt pages in the same folder/domain.
        if (pageType === 'homepage') {
          try {
            const { headerHtml, footerHtml } = extractHeaderFooter(fullHtml)
            if (headerHtml || footerHtml) {
              // 1. Save to folder brand_profile
              if (project.folder_id) {
                const { data: folder } = await supabase
                  .from('folders')
                  .select('brand_profile')
                  .eq('id', project.folder_id)
                  .single()
                const existing = folder?.brand_profile ?? {}
                await supabase
                  .from('folders')
                  .update({ brand_profile: { ...existing, headerHtml, footerHtml } })
                  .eq('id', project.folder_id)
                console.log(`[rebuild] saved header/footer to folder ${project.folder_id}`)
              }

              // 2. Propagate to all sibling pages that have already been rebuilt
              const domain = project.url ? (() => {
                try { return new URL(project.url).hostname.replace(/^www\./, '') } catch { return '' }
              })() : ''

              let siblingQuery = supabase
                .from('projects')
                .select('id, html_content')
                .eq('user_id', user.id)
                .neq('id', id)
                .not('html_content', 'is', null)

              if (project.folder_id) {
                siblingQuery = siblingQuery.eq('folder_id', project.folder_id)
              } else if (domain) {
                siblingQuery = siblingQuery.ilike('url', `%${domain}%`)
              }

              const { data: siblings } = await siblingQuery
              let propagated = 0
              for (const s of siblings ?? []) {
                if (!s.html_content?.includes('data-igualai-section')) continue
                const updated = replaceHeaderFooter(s.html_content, headerHtml, footerHtml)
                if (updated !== s.html_content) {
                  await supabase
                    .from('projects')
                    .update({ html_content: updated, updated_at: new Date().toISOString() })
                    .eq('id', s.id)
                  propagated++
                }
              }
              if (propagated > 0) {
                console.log(`[rebuild] propagated header/footer to ${propagated} sibling page(s)`)
              }
            }
          } catch (e) {
            console.error('[rebuild] failed to propagate header/footer:', e)
          }
        }

        send({ done: true, html: fullHtml })
      } catch (err) {
        const error = err as Error
        console.error('Rebuild error:', error)
        const isApiError = /GoogleGenerativeAI|fetchai|generativelanguage|googleapis/i.test(error.message)
        send({ error: isApiError ? 'AI service is temporarily unavailable. Please try again in a moment.' : error.message || 'Rebuild failed' })
      } finally {
        clearInterval(keepalive)
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
