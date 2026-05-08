import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, getWhopUser, getWhopMemberships, resolvePlan } from '@/lib/whop'
import { getSession } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://igualai.com'
  const redirectUri = `${appUrl}/api/auth/whop/callback`

  const code = request.nextUrl.searchParams.get('code')
  const error = request.nextUrl.searchParams.get('error')
  const isPopup = request.cookies.get('whop_auth_popup')?.value === '1'

  if (error || !code) {
    console.error('[Whop callback] error:', error)
    if (isPopup) {
      return new NextResponse(popupErrorHtml(), { headers: { 'Content-Type': 'text/html' } })
    }
    return NextResponse.redirect(`${appUrl}/?error=auth_failed`)
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri)
    const whopUser = await getWhopUser(tokens.access_token)
    const memberships = await getWhopMemberships(tokens.access_token)
    const plan = resolvePlan(memberships)

    const supabase = createServiceClient()
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, plan')
      .eq('clerk_id', whopUser.id)
      .single()

    if (!existingUser) {
      await supabase.from('users').insert({
        clerk_id: whopUser.id,
        email: whopUser.email,
        name: whopUser.name ?? whopUser.username,
        plan,
      })
    } else if (existingUser.plan !== plan) {
      await supabase.from('users').update({ plan }).eq('clerk_id', whopUser.id)
    }

    // Write session
    const session = await getSession()
    session.whopUserId = whopUser.id
    session.email = whopUser.email
    session.name = whopUser.name ?? whopUser.username
    await session.save()

    const next = request.cookies.get('whop_auth_next')?.value ?? '/dashboard'

    if (isPopup) {
      const html = popupSuccessHtml(appUrl, next)
      const response = new NextResponse(html, { headers: { 'Content-Type': 'text/html' } })
      response.cookies.delete('whop_auth_popup')
      response.cookies.delete('whop_auth_next')
      return response
    }

    const response = NextResponse.redirect(`${appUrl}${next}`)
    response.cookies.delete('whop_auth_next')
    return response
  } catch (err) {
    console.error('[Whop callback] error:', err)
    if (isPopup) {
      return new NextResponse(popupErrorHtml(), { headers: { 'Content-Type': 'text/html' } })
    }
    return NextResponse.redirect(`${appUrl}/?error=auth_failed`)
  }
}

function popupSuccessHtml(appUrl: string, next: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Signing in...</title></head>
<body>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'whop_auth_success', next: ${JSON.stringify(next)} }, ${JSON.stringify(appUrl)});
      window.close();
    } else {
      window.location.href = ${JSON.stringify(appUrl + next)};
    }
  } catch(e) {
    window.location.href = ${JSON.stringify(appUrl + next)};
  }
</script>
<p>Signing in...</p>
</body>
</html>`
}

function popupErrorHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ type: 'whop_auth_error' }, '*');
      window.close();
    }
  } catch(e) {}
</script>
<p>Authentication failed. Please close this window and try again.</p>
</body>
</html>`
}
