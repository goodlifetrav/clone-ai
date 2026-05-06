import { generateImage, isGeminiConfigured } from './gemini'
import { createServiceClient } from './supabase'

interface BrandContext {
  brandName: string
  brandDescription: string
  primaryColor: string
  secondaryColor: string
  tagline?: string
}

interface ImgMatch {
  fullTag: string
  src: string
  alt: string
}

const MAX_IMAGES = 3

/** Extract up to MAX_IMAGES <img> tags from HTML, skipping logos and data URIs. */
function extractImgTags(html: string, logoUrl?: string): ImgMatch[] {
  const results: ImgMatch[] = []
  // Match <img ... > tags (non-greedy)
  const tagRegex = /<img\s[^>]*>/gi
  let match: RegExpExecArray | null

  while ((match = tagRegex.exec(html)) !== null && results.length < MAX_IMAGES) {
    const fullTag = match[0]

    // Extract src
    const srcMatch = /\bsrc=["']([^"']+)["']/i.exec(fullTag)
    const src = srcMatch?.[1] ?? ''

    // Skip data URIs, logos, and SVGs
    if (!src || src.startsWith('data:') || src.endsWith('.svg')) continue
    if (logoUrl && src === logoUrl) continue

    // Extract alt
    const altMatch = /\balt=["']([^"']*)["']/i.exec(fullTag)
    const alt = altMatch?.[1] ?? ''

    results.push({ fullTag, src, alt })
  }

  return results
}

/** Build a Gemini image generation prompt from brand context + image alt text. */
function buildImagePrompt(brand: BrandContext, alt: string, index: number): string {
  const role = index === 0
    ? 'hero section image'
    : index === 1
    ? 'product or feature showcase image'
    : 'team or lifestyle image'

  const altHint = alt ? ` The image context is: "${alt}".` : ''

  return [
    `Create a professional, high-quality ${role} for a website.`,
    `Brand: ${brand.brandName}.`,
    `Business: ${brand.brandDescription}.`,
    altHint,
    `Brand colors: primary ${brand.primaryColor}, secondary ${brand.secondaryColor}.`,
    `Style: modern, clean, photographic quality. No text overlays. No logos.`,
    `Aspect ratio: landscape (16:9 or wider).`,
  ].join(' ')
}

/**
 * Generate brand images with Gemini and inject them into the HTML.
 * Uploads generated images to Supabase Storage and replaces <img> src attributes.
 *
 * @param html        The rebuilt HTML
 * @param brand       Brand context for image prompts
 * @param projectId   Used as the storage path prefix
 * @param onProgress  Called after each image is generated (1-based index, total)
 * @returns           Updated HTML with real image URLs
 */
export async function injectBrandImages(
  html: string,
  brand: BrandContext,
  projectId: string,
  onProgress?: (current: number, total: number) => void
): Promise<string> {
  if (!isGeminiConfigured()) return html

  const imgs = extractImgTags(html)
  if (imgs.length === 0) return html

  const supabase = createServiceClient()

  // Ensure bucket exists
  try {
    await supabase.storage.createBucket('uploads', { public: true })
  } catch { /* already exists */ }

  let updatedHtml = html

  for (let i = 0; i < imgs.length; i++) {
    const { fullTag, src, alt } = imgs[i]
    onProgress?.(i + 1, imgs.length)

    try {
      const prompt = buildImagePrompt(brand, alt, i)
      const generated = await generateImage(prompt)

      // Convert base64 to Buffer and upload
      const buffer = Buffer.from(generated.base64, 'base64')
      const ext = generated.mimeType === 'image/jpeg' ? 'jpg'
        : generated.mimeType === 'image/webp' ? 'webp'
        : 'png'
      const filename = `brand-${Date.now()}-${i}.${ext}`
      const path = `projects/${projectId}/${filename}`

      const { error: uploadError } = await supabase.storage
        .from('uploads')
        .upload(path, buffer, { contentType: generated.mimeType, upsert: false })

      if (uploadError) {
        console.error('[image-injection] upload error:', uploadError)
        continue
      }

      const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(path)

      // Replace the src in the matching img tag
      const newTag = fullTag.replace(src, publicUrl)
      updatedHtml = updatedHtml.replace(fullTag, newTag)
    } catch (err) {
      console.error(`[image-injection] failed for image ${i}:`, err)
      // Continue — skip this image rather than failing the whole rebuild
    }
  }

  return updatedHtml
}
