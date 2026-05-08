import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, getWhopUser, getWhopMemberships, resolvePlan } from '@/lib/whop'
import { getSession } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'
import { ghlCreateContact } from '@/lib/ghl'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://igualai.com'
  const redirectUri = `${appUrl}/api/auth/whop/callback`

  const code = request.nextUrl.searchParams.get('code')
  const error = request.nextUrl.searchParams.get('error')

  if (error || !code) {
    console.error('[Whop callback] error:', error)
    return NextResponse.redirect(`${appUrl}/sign-in?error=auth_failed`)
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, redirectUri)

    // Get user profile
    const whopUser = await getWhopUser(tokens.access_token)

    // Get memberships to determine plan
    const memberships = await getWhopMemberships(tokens.access_token)
    const plan = resolvePlan(memberships)

    // Upsert user in Supabase (clerk_id column stores Whop user ID)
    const supabase = createServiceClient()
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, plan')
      .eq('clerk_id', whopUser.id)
      .single()

    if (!existingUser) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          clerk_id: whopUser.id,
          email: whopUser.email,
          name: whopUser.name ?? whopUser.username,
          plan,
        })
        .select('id')
        .single()

      // Create GHL contact for new users
      if (newUser) {
        try {
          const nameParts = (whopUser.name ?? whopUser.username ?? '').split(' ')
          const firstName = nameParts[0] ?? ''
          const lastName = nameParts.slice(1).join(' ') ?? ''
          await ghlCreateContact(whopUser.email, firstName, lastName, ['igualai_free'])
        } catch (e) {
          console.error('[Whop callback] GHL contact creation failed:', e)
        }
      }
    } else if (existingUser.plan !== plan) {
      // Sync plan if it changed
      await supabase.from('users').update({ plan }).eq('clerk_id', whopUser.id)
    }

    // Write session
    const session = await getSession()
    session.whopUserId = whopUser.id
    session.email = whopUser.email
    session.name = whopUser.name ?? whopUser.username
    await session.save()

    // Redirect to intended destination
    const next = request.cookies.get('whop_auth_next')?.value ?? '/dashboard'
    const response = NextResponse.redirect(`${appUrl}${next}`)
    response.cookies.delete('whop_auth_next')
    return response
  } catch (err) {
    console.error('[Whop callback] error:', err)
    return NextResponse.redirect(`${appUrl}/sign-in?error=auth_failed`)
  }
}
