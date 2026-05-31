import { NextRequest, NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'

// SVG intentionally excluded: SVG can carry <script> + on*= handlers, and the
// uploaded file is served from a public bucket and rendered as part of the
// editor. Until we sanitize SVGs on the server, the safer default is to drop
// them from the allowlist entirely.
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
])
const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await getAuth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params

  const supabase = createServiceClient()

  // Verify the project belongs to this user
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_id', userId)
    .single()
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: 'Invalid file type. Allowed: jpg, png, gif, webp' },
      { status: 400 }
    )
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 })
  }

  // Ensure the bucket exists (ignore error if it already does)
  try {
    await supabase.storage.createBucket('uploads', { public: true })
  } catch {
    // bucket already exists — continue
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`
  const path = `projects/${projectId}/${filename}`

  const { error: uploadError } = await supabase.storage
    .from('uploads')
    .upload(path, buffer, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('[upload-image] Supabase storage error:', uploadError)
    return NextResponse.json({ error: 'Upload failed: ' + uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(path)
  console.log('[upload-image] success:', publicUrl)
  return NextResponse.json({ url: publicUrl })
}
