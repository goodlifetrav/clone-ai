import { NextResponse } from 'next/server'
import { getAuth } from '@/lib/auth'

export async function POST() {
  try {
    const { userId } = await getAuth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Whop manages billing — send user to their Whop account page
    return NextResponse.json({ url: 'https://whop.com/@me/' })
  } catch (err) {
    console.error('Portal error:', err)
    return NextResponse.json({ error: 'Failed to get billing portal' }, { status: 500 })
  }
}
