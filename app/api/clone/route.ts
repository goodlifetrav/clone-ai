import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { createServiceClient } from '@/lib/supabase'
import { extractDomain } from '@/lib/utils'
import { isAdminEmail } from '@/lib/admin'

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { url } = await request.json()
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 })

    const supabase = createServiceClient()

    let { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('clerk_id', userId)
      .single()

    if (userError || !user) {
      const clerkUser = await currentUser()
      const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? ''
      const name = clerkUser
        ? `${clerkUser.firstName ?? ''} ${clerkUser.lastName ?? ''}`.trim()
        : ''

      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({ clerk_id: userId, email, name, plan: 'free', tokens_used: 0, clones_count: 0 })
        .select()
        .single()

      if (createError || !newUser) {
        return NextResponse.json({ error: 'Failed to create user record' }, { status: 500 })
      }
      user = newUser
    }

    const adminByEmail = isAdminEmail(user.email)
    if (!user.is_admin && !adminByEmail && user.plan === 'free' && user.clones_count >= 1) {
      return NextResponse.json(
        { error: 'Free tier limit reached. Upgrade to clone more websites.', upgradeRequired: true },
        { status: 403 }
      )
    }

    const { data: project, error: projectCreateError } = await supabase
      .from('projects')
      .insert({
        user_id: user.id,
        name: extractDomain(url) || new URL(url).hostname,
        url,
        thumbnail_url: null,
        html_content: '',
        status: 'pending',
      })
      .select()
      .single()

    if (projectCreateError || !project) {
      console.error('Project create error:', projectCreateError)
      return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
    }

    return NextResponse.json({ projectId: project.id })
  } catch (err) {
    const error = err as Error
    console.error('Clone error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
