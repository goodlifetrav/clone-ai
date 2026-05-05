export type Plan = 'free' | 'pro' | 'agency'

export interface User {
  id: string
  clerk_id: string
  email: string
  name: string
  plan: Plan
  tokens_used: number
  clones_count: number
  is_admin: boolean
  stripe_customer_id: string | null
  created_at: string
}

export interface Project {
  id: string
  user_id: string
  name: string
  url: string
  thumbnail_url: string | null
  html_content: string
  status?: 'pending' | 'processing' | 'complete' | 'error'
  folder_id?: string | null
  created_at: string
  updated_at: string
}

export interface Folder {
  id: string
  user_id: string
  name: string
  created_at: string
}

export interface ProjectVersion {
  id: string
  project_id: string
  html_content: string
  created_at: string
  version_number: number
}

export interface ChatMessage {
  id: string
  project_id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface Billing {
  id: string
  user_id: string
  stripe_subscription_id: string | null
  plan: Plan
  status: string
  created_at: string
}

export interface PricingPlan {
  id: Plan
  name: string
  price: number
  priceId: string
  tokens: string
  features: string[]
  highlighted?: boolean
}

export const PLAN_LIMITS: Record<Plan, { clones: number; tokens: number }> = {
  free: { clones: 1, tokens: 10000 },
  pro: { clones: 20, tokens: 100000 },
  agency: { clones: 60, tokens: 300000 },
}
