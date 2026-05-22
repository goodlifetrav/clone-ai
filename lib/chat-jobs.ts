export type JobStatus = 'pending' | 'done' | 'error'

export interface ChatJob {
  id: string
  projectId: string
  status: JobStatus
  html?: string
  message?: string
  error?: string
  tokensUsed?: number
  estimatedCost?: number
  createdAt: number
}

// Module-level singleton — persists across requests on the same Node.js process.
// On a single-instance VPS (Hostinger Docker) this is always the same process.
const jobs = new Map<string, ChatJob>()

// Purge jobs older than 15 minutes to prevent unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id)
  }
}, 2 * 60 * 1000)

export function createJob(id: string, projectId: string): ChatJob {
  const job: ChatJob = { id, projectId, status: 'pending', createdAt: Date.now() }
  jobs.set(id, job)
  return job
}

export function getJob(id: string): ChatJob | undefined {
  return jobs.get(id)
}

export function completeJob(
  id: string,
  html: string,
  message: string,
  tokensUsed?: number,
  estimatedCost?: number
) {
  const job = jobs.get(id)
  if (job) jobs.set(id, { ...job, status: 'done', html, message, tokensUsed, estimatedCost })
}

export function failJob(id: string, error: string) {
  const job = jobs.get(id)
  if (job) jobs.set(id, { ...job, status: 'error', error })
}
