import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { sendTelegram } from '@/lib/telegram'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    const { projectId, projectName, url, message } = await request.json()

    await sendTelegram(
      `🚩 <b>Problem Report</b>\n` +
      `<b>Site:</b> ${projectName ?? 'unknown'} (${url ?? ''})\n` +
      `<b>Project:</b> ${projectId ?? ''}\n` +
      `<b>User:</b> ${session.email ?? 'unknown'}\n` +
      `<b>Issue:</b> ${message}`
    )

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
