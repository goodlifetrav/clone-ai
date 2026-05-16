import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { chatWithProjectGemini } from '@/lib/gemini'
import { injectBrandImages } from '@/lib/image-injection'
import { extractHeaderFooter } from '@/lib/header-footer'

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
    .select('html_content, user_id, folder_id')
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

  // Load shared header/footer from folder for non-homepage rebuilds
  let sharedHeaderHtml: string | undefined
  let sharedFooterHtml: string | undefined
  if (project.folder_id && pageType !== 'homepage') {
    const { data: folder } = await supabase
      .from('folders')
      .select('brand_profile')
      .eq('id', project.folder_id)
      .single()
    sharedHeaderHtml = folder?.brand_profile?.headerHtml || undefined
    sharedFooterHtml = folder?.brand_profile?.footerHtml || undefined
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

        // ── Image generation ─────────────────────────────────────────────────
        send({ status: 'generating_images' })
        const fullHtml = await injectBrandImages(
          fullHtmlRaw,
          { brandName, brandDescription, primaryColor, secondaryColor, tagline },
          id,
          (current, total) => send({ status: 'generating_images', current, total })
        )

        // Save to DB
        await supabase
          .from('projects')
          .update({ html_content: fullHtml, updated_at: new Date().toISOString() })
          .eq('id', id)

        // After a homepage rebuild, save the header/footer to the folder so
        // subsequent product/collection page rebuilds can use the same header/footer.
        if (pageType === 'homepage' && project.folder_id) {
          try {
            const { headerHtml, footerHtml } = extractHeaderFooter(fullHtml)
            if (headerHtml || footerHtml) {
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
              console.log(`[rebuild] saved header (${headerHtml.length} chars) + footer (${footerHtml.length} chars) to folder ${project.folder_id}`)
            }
          } catch (e) {
            console.error('[rebuild] failed to save header/footer to folder:', e)
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
