import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'

export interface SessionData {
  whopUserId?: string
  email?: string
  name?: string
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (secret && secret.length >= 32) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET environment variable is required in production (min 32 chars)')
  }
  return 'fallback-dev-secret-change-in-production-32chars'
}

export const sessionOptions = {
  cookieName: 'igualai_session',
  password: getSessionSecret(),
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
}

export async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, sessionOptions)
}

/** Drop-in replacement for Clerk's auth() — use in all API route handlers */
export async function getAuth(): Promise<{ userId: string | null }> {
  const session = await getSession()
  return { userId: session.whopUserId ?? null }
}
