import { redirect } from 'next/navigation'

// Redirect to Whop OAuth — middleware handles already-logged-in case
export default function SignInPage() {
  redirect('/api/auth/whop/login')
}
