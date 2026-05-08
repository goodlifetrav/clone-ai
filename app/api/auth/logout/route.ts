import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://igualai.com'
  const session = await getSession()
  session.destroy()
  return NextResponse.redirect(`${appUrl}/`)
}
