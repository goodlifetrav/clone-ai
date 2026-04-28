/**
 * Returns true if the given email is in the ADMIN_EMAILS env var
 * (comma-separated list).  Used to bypass plan/token limits server-side.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const raw = process.env.ADMIN_EMAILS ?? ''
  if (!raw.trim()) return false
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .includes(email.toLowerCase())
}
