import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getJob } from '@/lib/chat-jobs'

export async function GET(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('jobId')
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const job = getJob(jobId)
  if (!job) return NextResponse.json({ error: 'Job not found or expired' }, { status: 404 })

  if (job.status === 'pending') {
    return NextResponse.json({ status: 'pending' })
  }

  if (job.status === 'error') {
    return NextResponse.json({ status: 'error', error: job.error })
  }

  return NextResponse.json({
    status: 'done',
    html: job.html,
    message: job.message,
    messagesUsed: job.messagesUsed ?? 0,
    tokensUsed: job.tokensUsed ?? 0,
    estimatedCost: job.estimatedCost ?? 0,
  })
}
