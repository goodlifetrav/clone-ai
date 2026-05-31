import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { sendTelegram } from '@/lib/telegram'

// Telegram parse_mode=HTML treats <, >, & as markup. Without escaping,
// attacker-supplied message/projectName values could inject formatting
// (or break the message) and the endpoint can be used to spam the alert
// channel.
function tgEscape(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session.whopUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId, projectName, url, message } = await request.json()
    if (typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }
    // Cap message size so the endpoint can't be used to flood Telegram with
    // multi-MB payloads.
    const safeMessage = message.slice(0, 2000)

    await sendTelegram(
      `🚩 <b>Problem Report</b>\n` +
      `<b>Site:</b> ${tgEscape(projectName ?? 'unknown')} (${tgEscape(url ?? '')})\n` +
      `<b>Project:</b> ${tgEscape(projectId ?? '')}\n` +
      `<b>User:</b> ${tgEscape(session.email ?? 'unknown')}\n` +
      `<b>Issue:</b> ${tgEscape(safeMessage)}`
    )

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
