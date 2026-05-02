import { Resend } from 'resend'

export function reportError(
  err: unknown,
  route: string,
  context?: Record<string, unknown>
): void {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return

  const error = err instanceof Error ? err : new Error(String(err))
  const timestamp = new Date().toISOString()

  const body = [
    `<h2>Error in ${route}</h2>`,
    `<p><strong>Time:</strong> ${timestamp}</p>`,
    `<p><strong>Message:</strong> ${error.message}</p>`,
    error.stack
      ? `<p><strong>Stack:</strong></p><pre>${error.stack}</pre>`
      : '',
    context && Object.keys(context).length > 0
      ? `<p><strong>Context:</strong></p><pre>${JSON.stringify(context, null, 2)}</pre>`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  const resend = new Resend(resendKey)
  resend.emails
    .send({
      from: 'IgualAI Errors <noreply@igualai.com>',
      to: 'support@igualai.com',
      subject: `IgualAI Error: ${route}`,
      html: body,
    })
    .catch(() => {/* never let error reporting break anything */})
}
