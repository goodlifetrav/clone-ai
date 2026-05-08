import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export async function POST() {
  const session = await getSession()
  session.destroy()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://igualai.com'
  return NextResponse.redirect(`${appUrl}/`)
}

// Allow GET logout too for simple link-based logout
export async function GET() {
  const session = await getSession()
  session.destroy()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://igualai.com'
  return NextResponse.redirect(`${appUrl}/`)
}
