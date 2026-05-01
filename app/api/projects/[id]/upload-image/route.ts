import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { uploadToR2, isR2Configured } from '@/lib/r2'

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])
const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: projectId } = await params

  if (!isR2Configured()) {
    return NextResponse.json({ error: 'Image storage not configured' }, { status: 503 })
  }

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
      { error: 'Invalid file type. Allowed: jpg, png, gif, webp, svg' },
      { status: 400 }
    )
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`
  const key = `projects/${projectId}/uploads/${filename}`

  try {
    const url = await uploadToR2(buffer, key, file.type)
    console.log('[upload-image] success:', url)
    return NextResponse.json({ url })
  } catch (err) {
    console.error('[upload-image] R2 error:', err)
    return NextResponse.json({ error: 'Upload failed: ' + String(err) }, { status: 500 })
  }
}
