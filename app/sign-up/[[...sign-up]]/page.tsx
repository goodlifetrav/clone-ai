import { redirect } from 'next/navigation'

// Sign up also goes through Whop (same OAuth flow)
export default function SignUpPage() {
  redirect('/api/auth/whop/login')
}
